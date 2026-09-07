import { describe, expect, it } from 'vitest';
import { extractEntities, mergeEntities } from '@/lib/ai/entities';

const NOW = new Date('2026-09-07T10:00:00Z');

describe('extractEntities', () => {
  it('reads "15 Sept" as the next occurrence of that date', () => {
    expect(extractEntities('Room available on 15 Sept?', NOW).checkIn).toBe('2026-09-15');
  });

  it('rolls a past day/month forward to next year', () => {
    expect(extractEntities('Any room on 1 March?', NOW).checkIn).toBe('2027-03-01');
  });

  it('reads ISO dates', () => {
    expect(extractEntities('Booking for 2026-12-24', NOW).checkIn).toBe('2026-12-24');
  });

  it('reads day-first numeric dates', () => {
    expect(extractEntities('We arrive 15/10', NOW).checkIn).toBe('2026-10-15');
  });

  it('resolves relative dates', () => {
    expect(extractEntities('tomorrow available?', NOW).checkIn).toBe('2026-09-08');
    expect(extractEntities('room for tonight', NOW).checkIn).toBe('2026-09-07');
  });

  it('reads guest counts in several phrasings', () => {
    expect(extractEntities('2 person', NOW).guests).toBe(2);
    expect(extractEntities('for 3 adults', NOW).guests).toBe(3);
    expect(extractEntities('4 pax', NOW).guests).toBe(4);
    expect(extractEntities('2', NOW).guests).toBe(2);
  });

  it('does not read a bare number inside a sentence as a guest count', () => {
    expect(extractEntities('Room 402 was noisy', NOW).guests).toBeUndefined();
  });

  it('derives the check-out date from nights', () => {
    const result = extractEntities('15 Sept for 3 nights', NOW);
    expect(result.checkIn).toBe('2026-09-15');
    expect(result.nights).toBe(3);
    expect(result.checkOut).toBe('2026-09-18');
  });

  it('reads a room preference', () => {
    expect(extractEntities('Is the deluxe free?', NOW).roomPreference).toBe('Deluxe');
  });

  it('returns nothing for empty input', () => {
    expect(extractEntities('', NOW)).toEqual({});
  });
});

describe('mergeEntities', () => {
  it('lets new information fill gaps without erasing what is known', () => {
    const merged = mergeEntities(
      { checkIn: '2026-09-15', guests: 2 },
      { guests: 3, roomPreference: 'Suite' },
    );
    expect(merged.checkIn).toBe('2026-09-15');
    expect(merged.guests).toBe(3);
    expect(merged.roomPreference).toBe('Suite');
  });
});
