import { describe, expect, it } from 'vitest';
import {
  SIGNAL_WEIGHTS,
  deriveLeadScore,
  detectSignals,
  scoreFromSignals,
  temperatureForScore,
} from '@/lib/leads/scoring';

describe('signal detection', () => {
  it('detects availability questions in plain English and Hinglish', () => {
    expect(detectSignals('Do you have any rooms for Friday?')).toContain('asked_availability');
    expect(detectSignals('room hai?')).toContain('asked_availability');
    expect(detectSignals('khali hai kya')).toContain('asked_availability');
  });

  it('detects price questions', () => {
    expect(detectSignals('How much per night?')).toContain('asked_price');
    expect(detectSignals('price kya hai')).toContain('asked_price');
    expect(detectSignals('what is the tariff')).toContain('asked_price');
  });

  it('detects booking and payment intent', () => {
    expect(detectSignals('Yes, book it')).toContain('asked_to_book');
    expect(detectSignals('Can I pay by UPI?')).toContain('asked_payment');
  });

  it('detects negative signals', () => {
    expect(detectSignals('just checking for now')).toContain('just_checking');
    expect(detectSignals('I am comparing a few hotels')).toContain('comparing_hotels');
    expect(detectSignals('not interested, thanks')).toContain('not_interested');
  });

  it('returns nothing for an empty message', () => {
    expect(detectSignals('')).toEqual([]);
    expect(detectSignals('   ')).toEqual([]);
  });
});

describe('score arithmetic', () => {
  it('sums unique signal weights', () => {
    const result = scoreFromSignals(['asked_availability', 'provided_dates']);
    expect(result.score).toBe(SIGNAL_WEIGHTS.asked_availability + SIGNAL_WEIGHTS.provided_dates);
  });

  it('never counts a repeated signal twice', () => {
    const once = scoreFromSignals(['asked_price']);
    const thrice = scoreFromSignals(['asked_price', 'asked_price', 'asked_price']);
    expect(thrice.score).toBe(once.score);
  });

  it('clamps into the 0-100 range', () => {
    const high = scoreFromSignals([
      'asked_availability',
      'provided_dates',
      'provided_guests',
      'asked_price',
      'asked_to_book',
      'asked_payment',
      'asked_room_options',
      'asked_location',
    ]);
    expect(high.score).toBe(100);

    const low = scoreFromSignals(['not_interested', 'just_checking', 'inactive']);
    expect(low.score).toBe(0);
  });

  it('maps scores onto the documented temperature bands', () => {
    expect(temperatureForScore(100)).toBe('hot');
    expect(temperatureForScore(80)).toBe('hot');
    expect(temperatureForScore(79)).toBe('warm');
    expect(temperatureForScore(50)).toBe('warm');
    expect(temperatureForScore(49)).toBe('cold');
    expect(temperatureForScore(20)).toBe('cold');
    expect(temperatureForScore(19)).toBe('low');
    expect(temperatureForScore(0)).toBe('low');
  });
});

describe('deriveLeadScore', () => {
  it('walks the demo conversation from cold to warm', () => {
    const first = deriveLeadScore({
      customerMessages: ['Hi, room available for 15 Sept?'],
      entities: { checkIn: '2026-09-15', guests: null },
    });
    expect(first.signals).toContain('asked_availability');
    expect(first.signals).toContain('provided_dates');
    expect(first.score).toBe(35);
    expect(first.temperature).toBe('cold');

    const second = deriveLeadScore({
      customerMessages: ['Hi, room available for 15 Sept?', '2'],
      entities: { checkIn: '2026-09-15', guests: 2 },
    });
    expect(second.score).toBe(50);
    expect(second.temperature).toBe('warm');
  });

  it('turns hot once the guest asks to book', () => {
    const result = deriveLeadScore({
      customerMessages: [
        'Hi, room available for 15 Sept?',
        '2 people',
        'What is the price?',
        'Yes, book it',
      ],
      entities: { checkIn: '2026-09-15', guests: 2 },
    });
    expect(result.temperature).toBe('hot');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('applies the inactivity penalty only past the threshold', () => {
    const base = {
      customerMessages: ['Do you have rooms available?'],
      entities: { checkIn: null, guests: null },
    };
    const active = deriveLeadScore({ ...base, minutesSinceLastCustomerMessage: 60 });
    const inactive = deriveLeadScore({ ...base, minutesSinceLastCustomerMessage: 24 * 60 });
    expect(inactive.score).toBe(active.score + SIGNAL_WEIGHTS.inactive);
    expect(inactive.signals).toContain('inactive');
  });

  it('reads dates and guests from stored entities, not just phrasing', () => {
    const result = deriveLeadScore({
      customerMessages: ['2'],
      entities: { checkIn: '2026-09-15', checkOut: '2026-09-17', guests: 2 },
    });
    expect(result.signals).toContain('provided_dates');
    expect(result.signals).toContain('provided_guests');
  });
});
