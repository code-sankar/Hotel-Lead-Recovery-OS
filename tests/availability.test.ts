import { describe, expect, it } from 'vitest';
import {
  calculateAvailability,
  nightsBetween,
  normaliseStay,
  type AvailabilityRoom,
} from '@/lib/availability/calculate';

/**
 * Availability is now the factual basis for the one claim the assistant used to
 * be forbidden from making, so the arithmetic is pinned down here.
 */

const ROOMS: AvailabilityRoom[] = [
  { id: 'deluxe', name: 'Deluxe Room', basePrice: 2800, maxGuests: 2, totalUnits: 4 },
  { id: 'executive', name: 'Executive Room', basePrice: 3500, maxGuests: 3, totalUnits: 2 },
  { id: 'suite', name: 'Suite', basePrice: 5500, maxGuests: 4, totalUnits: 1 },
];

function query(overrides: Partial<Parameters<typeof calculateAvailability>[0]> = {}) {
  return calculateAvailability({
    checkIn: '2026-09-15',
    checkOut: '2026-09-17',
    rooms: ROOMS,
    overrides: [],
    bookings: [],
    ...overrides,
  });
}

describe('nightsBetween', () => {
  it('counts check-in inclusive and check-out exclusive', () => {
    expect(nightsBetween('2026-09-15', '2026-09-17')).toEqual(['2026-09-15', '2026-09-16']);
  });

  it('returns nothing when the stay has no nights', () => {
    expect(nightsBetween('2026-09-15', '2026-09-15')).toEqual([]);
    expect(nightsBetween('2026-09-17', '2026-09-15')).toEqual([]);
  });

  it('rejects malformed dates rather than guessing', () => {
    expect(nightsBetween('15 Sept', '2026-09-17')).toEqual([]);
    expect(nightsBetween('2026-13-45', '2026-09-17')).toEqual([]);
  });

  it('crosses a month boundary correctly', () => {
    expect(nightsBetween('2026-09-30', '2026-10-02')).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('normaliseStay', () => {
  it('treats a lone date as a one-night stay', () => {
    expect(normaliseStay('2026-09-15')).toEqual({ checkIn: '2026-09-15', checkOut: '2026-09-16' });
  });

  it('ignores a checkout that is not after check-in', () => {
    expect(normaliseStay('2026-09-15', '2026-09-14')).toEqual({
      checkIn: '2026-09-15',
      checkOut: '2026-09-16',
    });
  });

  it('rejects an invalid check-in', () => {
    expect(normaliseStay('tomorrow')).toBeNull();
  });
});

describe('calculateAvailability', () => {
  it('reports full capacity when nothing is booked or blocked', () => {
    const snapshot = query();
    expect(snapshot.nights).toBe(2);
    expect(snapshot.anyAvailable).toBe(true);
    expect(snapshot.rooms.find((r) => r.roomId === 'deluxe')?.unitsFree).toBe(4);
    expect(snapshot.rooms.find((r) => r.roomId === 'suite')?.unitsFree).toBe(1);
  });

  it('subtracts confirmed bookings night by night', () => {
    const snapshot = query({
      bookings: [{ roomId: 'deluxe', checkIn: '2026-09-15', checkOut: '2026-09-16', units: 3 }],
    });
    const deluxe = snapshot.rooms.find((r) => r.roomId === 'deluxe');
    // Tightest night is the 15th: 4 - 3 = 1.
    expect(deluxe?.unitsFree).toBe(1);
    expect(deluxe?.nights[0]).toMatchObject({ date: '2026-09-15', booked: 3, free: 1 });
    expect(deluxe?.nights[1]).toMatchObject({ date: '2026-09-16', booked: 0, free: 4 });
  });

  it('lets two stays share a changeover day', () => {
    const snapshot = query({
      checkIn: '2026-09-16',
      checkOut: '2026-09-17',
      bookings: [{ roomId: 'suite', checkIn: '2026-09-15', checkOut: '2026-09-16', units: 1 }],
    });
    // The departing guest does not occupy the night of the 16th.
    expect(snapshot.rooms.find((r) => r.roomId === 'suite')?.unitsFree).toBe(1);
  });

  it('sells out a room when every unit is taken', () => {
    const snapshot = query({
      bookings: [{ roomId: 'suite', checkIn: '2026-09-15', checkOut: '2026-09-17', units: 1 }],
    });
    const suite = snapshot.rooms.find((r) => r.roomId === 'suite');
    expect(suite?.available).toBe(false);
    expect(suite?.unitsFree).toBe(0);
    expect(suite?.soldOutDates).toEqual(['2026-09-15', '2026-09-16']);
    // Other room types are unaffected.
    expect(snapshot.anyAvailable).toBe(true);
  });

  it('honours a closed date', () => {
    const snapshot = query({
      overrides: [{ roomId: 'deluxe', date: '2026-09-16', unitsAvailable: null, closed: true }],
    });
    const deluxe = snapshot.rooms.find((r) => r.roomId === 'deluxe');
    expect(deluxe?.unitsFree).toBe(0);
    expect(deluxe?.available).toBe(false);
    expect(deluxe?.soldOutDates).toEqual(['2026-09-16']);
  });

  it('honours a reduced allotment', () => {
    const snapshot = query({
      overrides: [{ roomId: 'deluxe', date: '2026-09-15', unitsAvailable: 1, closed: false }],
    });
    expect(snapshot.rooms.find((r) => r.roomId === 'deluxe')?.unitsFree).toBe(1);
  });

  it('lets an override raise capacity above the default', () => {
    const snapshot = query({
      overrides: [
        { roomId: 'suite', date: '2026-09-15', unitsAvailable: 3, closed: false },
        { roomId: 'suite', date: '2026-09-16', unitsAvailable: 3, closed: false },
      ],
    });
    expect(snapshot.rooms.find((r) => r.roomId === 'suite')?.unitsFree).toBe(3);
  });

  it('applies overrides and bookings together', () => {
    const snapshot = query({
      overrides: [{ roomId: 'deluxe', date: '2026-09-15', unitsAvailable: 2, closed: false }],
      bookings: [{ roomId: 'deluxe', checkIn: '2026-09-15', checkOut: '2026-09-17', units: 2 }],
    });
    expect(snapshot.rooms.find((r) => r.roomId === 'deluxe')?.unitsFree).toBe(0);
  });

  it('never reports negative availability when overbooked', () => {
    const snapshot = query({
      bookings: [{ roomId: 'suite', checkIn: '2026-09-15', checkOut: '2026-09-17', units: 5 }],
    });
    expect(snapshot.rooms.find((r) => r.roomId === 'suite')?.unitsFree).toBe(0);
  });

  it('drops room types that cannot seat the party', () => {
    const snapshot = query({ guests: 4 });
    expect(snapshot.rooms.map((r) => r.roomId)).toEqual(['suite']);
  });

  it('requires enough units for the whole party when several rooms are wanted', () => {
    const snapshot = query({
      unitsWanted: 3,
      bookings: [{ roomId: 'deluxe', checkIn: '2026-09-15', checkOut: '2026-09-17', units: 2 }],
    });
    const deluxe = snapshot.rooms.find((r) => r.roomId === 'deluxe');
    expect(deluxe?.unitsFree).toBe(2);
    expect(deluxe?.available).toBe(false);
  });

  it('reports nothing available for an unusable date range', () => {
    const snapshot = calculateAvailability({
      checkIn: 'not-a-date',
      checkOut: '2026-09-17',
      rooms: ROOMS,
      overrides: [],
      bookings: [],
    });
    expect(snapshot.nights).toBe(0);
    expect(snapshot.anyAvailable).toBe(false);
  });

  it('treats a hotel with no units configured as sold out, not as unlimited', () => {
    const snapshot = query({
      rooms: [{ id: 'deluxe', name: 'Deluxe Room', basePrice: 2800, maxGuests: 2, totalUnits: 0 }],
    });
    expect(snapshot.anyAvailable).toBe(false);
  });

  it('ignores bookings for other room types', () => {
    const snapshot = query({
      bookings: [{ roomId: 'executive', checkIn: '2026-09-15', checkOut: '2026-09-17', units: 2 }],
    });
    expect(snapshot.rooms.find((r) => r.roomId === 'deluxe')?.unitsFree).toBe(4);
    expect(snapshot.rooms.find((r) => r.roomId === 'executive')?.available).toBe(false);
  });
});
