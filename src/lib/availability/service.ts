import type { Store } from '@/lib/db/store';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import {
  calculateAvailability,
  isIsoDate,
  normaliseStay,
  type AvailabilityRoom,
  type AvailabilitySnapshot,
} from './calculate';

/**
 * Loads the inventory a stay depends on and runs the calculation.
 *
 * Deliberately thin: the arithmetic lives in calculate.ts, which has no I/O and
 * carries the tests. This module only fetches the right rows.
 */

export interface StayRequest {
  checkIn: string | null | undefined;
  checkOut?: string | null;
  guests?: number | null;
  unitsWanted?: number;
}

export function roomsFromKnowledge(knowledge: HotelKnowledge): AvailabilityRoom[] {
  return knowledge.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    basePrice: room.basePrice,
    maxGuests: room.maxGuests,
    totalUnits: room.totalUnits,
  }));
}

/**
 * Returns null when there is nothing to check — no dates, or no rooms
 * configured. Callers must treat null as "not verified", never as "available".
 */
export async function checkAvailability(
  store: Store,
  businessId: string,
  rooms: AvailabilityRoom[],
  request: StayRequest,
): Promise<AvailabilitySnapshot | null> {
  if (!isIsoDate(request.checkIn) || rooms.length === 0) return null;

  const stay = normaliseStay(request.checkIn, request.checkOut ?? null);
  if (!stay) return null;

  const [overrides, bookings] = await Promise.all([
    store.listRoomAvailability(businessId, stay.checkIn, stay.checkOut),
    store.listBookings(businessId, stay.checkIn, stay.checkOut),
  ]);

  return calculateAvailability({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    rooms,
    overrides: overrides.map((row) => ({
      roomId: row.room_id,
      date: row.date,
      unitsAvailable: row.units_available,
      closed: row.closed,
    })),
    bookings: bookings.map((booking) => ({
      roomId: booking.room_id,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      units: booking.units,
    })),
    guests: request.guests ?? null,
    unitsWanted: request.unitsWanted,
  });
}

/** Calendar grid for the availability settings page. */
export async function availabilityCalendar(
  store: Store,
  businessId: string,
  rooms: AvailabilityRoom[],
  from: string,
  days: number,
): Promise<AvailabilitySnapshot | null> {
  if (!isIsoDate(from) || rooms.length === 0) return null;
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [overrides, bookings] = await Promise.all([
    store.listRoomAvailability(businessId, from, to),
    store.listBookings(businessId, from, to),
  ]);

  return calculateAvailability({
    checkIn: from,
    checkOut: to,
    rooms,
    overrides: overrides.map((row) => ({
      roomId: row.room_id,
      date: row.date,
      unitsAvailable: row.units_available,
      closed: row.closed,
    })),
    bookings: bookings.map((booking) => ({
      roomId: booking.room_id,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      units: booking.units,
    })),
  });
}

export * from './calculate';
