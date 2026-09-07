import { describe, expect, it } from 'vitest';
import { classifyIntent, intentRequiresHuman, isOptOut, isQualifyingIntent } from '@/lib/ai/intent';

describe('classifyIntent', () => {
  const cases: Array<[string, string]> = [
    ['Do you have a room for tomorrow?', 'room_availability'],
    ['room hai?', 'room_availability'],
    ['price kya hai', 'pricing'],
    ['How much for a deluxe room?', 'pricing'],
    ['Yes, book it', 'booking_intent'],
    ['Can I pay by UPI?', 'payment'],
    ['What is your cancellation policy?', 'cancellation'],
    ['Any discount available?', 'discount_request'],
    ['best price?', 'discount_request'],
    ['We need 10 rooms for a group', 'group_booking'],
    ['Do you have a banquet hall for a wedding?', 'event_or_conference'],
    ['Do you arrange airport pickup?', 'airport_transfer'],
    ['Where is the hotel located?', 'location'],
    ['check in 2pm possible?', 'check_in_out'],
    ['Is Wi-Fi free?', 'amenities'],
    ['breakfast included?', 'amenities'],
    ['I want to speak to a human', 'human_help'],
    ['The room was dirty, I want to complain', 'complaint'],
  ];

  for (const [message, expected] of cases) {
    it(`classifies "${message}" as ${expected}`, () => {
      expect(classifyIntent(message).intent).toBe(expected);
    });
  }

  it('returns unknown with low confidence for unrecognised text', () => {
    const result = classifyIntent('qwerty asdf');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns unknown for empty input', () => {
    expect(classifyIntent('').intent).toBe('unknown');
    expect(classifyIntent('').confidence).toBe(0);
  });

  it('lowers confidence when several rules match', () => {
    const single = classifyIntent('Where is the hotel located?');
    const multi = classifyIntent('What is the price and is parking available and where are you?');
    expect(multi.confidence).toBeLessThan(single.confidence);
  });
});

describe('intent policy helpers', () => {
  it('escalates complaints, payment issues and human requests', () => {
    expect(intentRequiresHuman('complaint')).toBe(true);
    expect(intentRequiresHuman('payment')).toBe(true);
    expect(intentRequiresHuman('human_help')).toBe(true);
    expect(intentRequiresHuman('pricing')).toBe(false);
  });

  it('treats commercial enquiries as qualifying', () => {
    expect(isQualifyingIntent('room_availability')).toBe(true);
    expect(isQualifyingIntent('booking_intent')).toBe(true);
    expect(isQualifyingIntent('complaint')).toBe(false);
  });
});

describe('isOptOut', () => {
  it('detects opt-out phrasing', () => {
    expect(isOptOut('stop')).toBe(true);
    expect(isOptOut('please unsubscribe')).toBe(true);
    expect(isOptOut("don't message me again")).toBe(true);
    expect(isOptOut('Can you send me the rates?')).toBe(false);
  });
});
