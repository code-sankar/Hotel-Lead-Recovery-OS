/**
 * Availability arithmetic.
 *
 * Pure and I/O-free, because this is now the factual basis for the single
 * claim the assistant was previously forbidden from making. If this is wrong,
 * the product lies to guests — so it is kept small, explicit and heavily
 * tested.
 *
 * For one room on one night:
 *
 *   units = closed ? 0 : (override.units_available ?? room.totalUnits)
 *   free  = max(0, units - units booked that night)
 *
 * A stay occupies the nights [check_in, check_out) — the checkout date itself
 * is not a night, so two stays may share a changeover day.
 */

export interface AvailabilityRoom {
  id: string;
  name: string;
  basePrice: number;
  maxGuests: number;
  totalUnits: number;
}

export interface AvailabilityOverride {
  roomId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  unitsAvailable: number | null;
  closed: boolean;
}

export interface AvailabilityBooking {
  roomId: string;
  checkIn: string;
  checkOut: string;
  units: number;
}

export interface NightAvailability {
  date: string;
  /** Units the hotel offers that night, after overrides. */
  capacity: number;
  booked: number;
  free: number;
  closed: boolean;
}

export interface RoomAvailabilityResult {
  roomId: string;
  roomName: string;
  basePrice: number;
  maxGuests: number;
  /** Free units on the tightest night — what can actually be sold for the stay. */
  unitsFree: number;
  available: boolean;
  nights: NightAvailability[];
  /** Nights with nothing free, so staff can see exactly where a stay breaks. */
  soldOutDates: string[];
}

export interface AvailabilityQuery {
  checkIn: string;
  checkOut: string;
  rooms: AvailabilityRoom[];
  overrides: AvailabilityOverride[];
  bookings: AvailabilityBooking[];
  /** Drop room types that cannot seat this many guests. */
  guests?: number | null;
  unitsWanted?: number;
}

export interface AvailabilitySnapshot {
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number | null;
  rooms: RoomAvailabilityResult[];
  /** True when at least one room type can cover the whole stay. */
  anyAvailable: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A single enquiry cannot be allowed to expand into an unbounded scan. */
export const MAX_NIGHTS = 90;

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The nights a stay occupies: check-in inclusive, check-out exclusive. */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return [];
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (end <= start) return [];

  const nights: string[] = [];
  for (let time = start; time < end && nights.length < MAX_NIGHTS; time += 86_400_000) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }
  return nights;
}

/**
 * A single date with no checkout is treated as a one-night stay, which is what
 * a guest asking "any room on the 15th?" means.
 */
export function normaliseStay(
  checkIn: string,
  checkOut?: string | null,
): { checkIn: string; checkOut: string } | null {
  if (!isIsoDate(checkIn)) return null;
  if (checkOut && isIsoDate(checkOut) && Date.parse(checkOut) > Date.parse(checkIn)) {
    return { checkIn, checkOut };
  }
  const next = new Date(Date.parse(`${checkIn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { checkIn, checkOut: next };
}

function overrideKey(roomId: string, date: string): string {
  return `${roomId}|${date}`;
}

export function calculateAvailability(query: AvailabilityQuery): AvailabilitySnapshot {
  const stay = normaliseStay(query.checkIn, query.checkOut);
  const nights = stay ? nightsBetween(stay.checkIn, stay.checkOut) : [];
  const unitsWanted = Math.max(1, query.unitsWanted ?? 1);

  const overrideBy = new Map<string, AvailabilityOverride>();
  for (const override of query.overrides) {
    overrideBy.set(overrideKey(override.roomId, override.date), override);
  }

  // Booked units per room per night.
  const bookedBy = new Map<string, number>();
  for (const booking of query.bookings) {
    for (const night of nightsBetween(booking.checkIn, booking.checkOut)) {
      const key = overrideKey(booking.roomId, night);
      bookedBy.set(key, (bookedBy.get(key) ?? 0) + Math.max(0, booking.units));
    }
  }

  const candidateRooms = query.guests
    ? query.rooms.filter((room) => room.maxGuests >= (query.guests as number))
    : query.rooms;

  const rooms: RoomAvailabilityResult[] = candidateRooms.map((room) => {
    const perNight: NightAvailability[] = nights.map((date) => {
      const override = overrideBy.get(overrideKey(room.id, date));
      const closed = override?.closed ?? false;
      const capacity = closed ? 0 : (override?.unitsAvailable ?? room.totalUnits);
      const booked = bookedBy.get(overrideKey(room.id, date)) ?? 0;
      return { date, capacity, booked, free: Math.max(0, capacity - booked), closed };
    });

    // The stay is limited by its tightest night.
    const unitsFree = perNight.length === 0 ? 0 : Math.min(...perNight.map((night) => night.free));

    return {
      roomId: room.id,
      roomName: room.name,
      basePrice: room.basePrice,
      maxGuests: room.maxGuests,
      unitsFree,
      available: unitsFree >= unitsWanted,
      nights: perNight,
      soldOutDates: perNight.filter((night) => night.free <= 0).map((night) => night.date),
    };
  });

  return {
    checkIn: stay?.checkIn ?? query.checkIn,
    checkOut: stay?.checkOut ?? query.checkOut,
    nights: nights.length,
    guests: query.guests ?? null,
    rooms,
    anyAvailable: rooms.some((room) => room.available),
  };
}

/** One-line summary used in the lead panel and in AI context. */
export function summariseAvailability(snapshot: AvailabilitySnapshot): string {
  if (snapshot.nights === 0) return 'No valid dates to check.';
  const available = snapshot.rooms.filter((room) => room.available);
  if (available.length === 0) {
    return `Nothing free for ${snapshot.checkIn} to ${snapshot.checkOut}.`;
  }
  return available
    .map((room) => `${room.roomName}: ${room.unitsFree} free`)
    .join(', ');
}
