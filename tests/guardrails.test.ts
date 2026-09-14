import { describe, expect, it } from 'vitest';
import {
  checkReply,
  enforceGuardrails,
  extractMoneyValues,
  type AvailabilityContext,
} from '@/lib/ai/guardrails';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import { MemoryStore } from './support/memory-store';
import { seedBusiness } from './support/fixtures';

function knowledge(): HotelKnowledge {
  return seedBusiness(new MemoryStore()).knowledge;
}

describe('extractMoneyValues', () => {
  it('reads currency-marked amounts', () => {
    expect(extractMoneyValues('₹2,800 per night')).toContain(2800);
    expect(extractMoneyValues('Rs. 3500')).toContain(3500);
    expect(extractMoneyValues('INR 5500')).toContain(5500);
  });

  it('reads bare nightly rates', () => {
    expect(extractMoneyValues('2800 per night')).toContain(2800);
  });

  it('ignores small numbers that are not money', () => {
    expect(extractMoneyValues('check-in is at 12 and we have 3 room types')).toEqual([]);
  });
});

const VERIFIED: AvailabilityContext = {
  checkIn: '2026-09-15',
  checkOut: '2026-09-17',
  anyAvailable: true,
  availableRoomNames: ['Deluxe Room', 'Executive Room'],
  soldOutRoomNames: ['Suite'],
};

describe('guardrails — availability without a verified lookup', () => {
  it('blocks a definite availability claim when nothing was checked', () => {
    const result = checkReply({
      reply: 'Yes, we have a Deluxe Room available for 15 September.',
      knowledge: knowledge(),
    });
    expect(result.flags).toContain('unverified_availability');
  });

  it('allows the same answer when it defers to the hotel team', () => {
    const result = checkReply({
      reply:
        'Our Deluxe Room sleeps 2 at ₹2,800 per night. I will need the hotel team to confirm availability for your dates.',
      knowledge: knowledge(),
    });
    expect(result.flags).toHaveLength(0);
  });

  it('blocks a claim that a room has been held', () => {
    const result = checkReply({
      reply: 'I have blocked the Suite for you.',
      knowledge: knowledge(),
    });
    expect(result.flags).toContain('unverified_availability');
  });
});

describe('guardrails — availability with a verified lookup', () => {
  it('allows a claim the inventory supports', () => {
    const result = checkReply({
      reply: 'Yes, the Deluxe Room is available for 15 September at ₹2,800 per night.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toHaveLength(0);
  });

  it('blocks a claim about a room that is sold out', () => {
    const result = checkReply({
      reply: 'Yes, the Suite is available for those dates.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toContain('contradicts_availability');
  });

  it('blocks any availability claim when the whole hotel is full', () => {
    const result = checkReply({
      reply: 'Yes, we have rooms available.',
      knowledge: knowledge(),
      availability: { ...VERIFIED, anyAvailable: false, availableRoomNames: [], soldOutRoomNames: ['Deluxe Room'] },
    });
    expect(result.flags).toContain('contradicts_availability');
  });

  it('allows a truthful mix of free and full rooms in one sentence', () => {
    const result = checkReply({
      reply: 'The Deluxe Room is available, but the Suite is fully booked for those dates.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toHaveLength(0);
  });

  it('blocks a claim about dates that were never checked', () => {
    const result = checkReply({
      reply: 'Yes, we have a Deluxe Room available on 25 December.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toContain('unverified_availability');
  });

  it('blocks wrongly telling a guest the hotel is full', () => {
    const result = checkReply({
      reply: 'Sorry, we are fully booked for those dates.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toContain('wrong_sold_out');
  });

  it('blocks wrongly calling one free room unavailable', () => {
    const result = checkReply({
      reply: 'The Deluxe Room is not available for those dates.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toContain('wrong_sold_out');
  });

  it('allows a truthful sold-out answer', () => {
    const result = checkReply({
      reply: 'The Suite is fully booked for those dates.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toHaveLength(0);
  });

  it('allows a truthful sold-out answer when the hotel really is full', () => {
    const result = checkReply({
      reply: 'Sorry, we are fully booked for those dates.',
      knowledge: knowledge(),
      availability: { ...VERIFIED, anyAvailable: false, availableRoomNames: [], soldOutRoomNames: ['Deluxe Room'] },
    });
    expect(result.flags).toHaveLength(0);
  });

  it('still refuses to claim a booking exists', () => {
    const result = checkReply({
      reply: 'The Deluxe Room is available and your booking is confirmed.',
      knowledge: knowledge(),
      availability: VERIFIED,
    });
    expect(result.flags).toContain('claimed_booking');
  });
});

describe('guardrails — bookings, payments, discounts', () => {
  it('blocks invented booking confirmations', () => {
    expect(
      checkReply({ reply: 'Your booking is confirmed for 15 September.', knowledge: knowledge() })
        .flags,
    ).toContain('claimed_booking');
  });

  it('blocks invented payment confirmations', () => {
    expect(
      checkReply({ reply: 'Payment received, thank you!', knowledge: knowledge() }).flags,
    ).toContain('claimed_payment');
  });

  it('blocks invented discounts', () => {
    expect(
      checkReply({ reply: 'I can give you 10% off for a two-night stay.', knowledge: knowledge() })
        .flags,
    ).toContain('invented_discount');
    expect(
      checkReply({ reply: 'We can offer a special rate for you.', knowledge: knowledge() }).flags,
    ).toContain('invented_discount');
  });
});

describe('guardrails — prices and room names', () => {
  it('allows prices that come from the hotel data', () => {
    const result = checkReply({
      reply: 'The Deluxe Room is ₹2,800 per night and the Suite is ₹5,500 per night.',
      knowledge: knowledge(),
    });
    expect(result.flags).not.toContain('invented_price');
  });

  it('allows arithmetic on a configured nightly rate', () => {
    const result = checkReply({
      reply: 'Three nights in the Deluxe Room would be ₹8,400 in total.',
      knowledge: knowledge(),
    });
    expect(result.flags).not.toContain('invented_price');
  });

  it('blocks a price that appears nowhere in the hotel data', () => {
    const result = checkReply({
      reply: 'The Deluxe Room is ₹1,999 per night.',
      knowledge: knowledge(),
    });
    expect(result.flags).toContain('invented_price');
  });

  it('allows a price the customer themselves quoted', () => {
    const result = checkReply({
      reply: 'I can pass on your budget of ₹1,999 to our team.',
      knowledge: knowledge(),
      conversationContext: ['My budget is ₹1,999 per night'],
    });
    expect(result.flags).not.toContain('invented_price');
  });

  it('blocks a room type the hotel does not have', () => {
    const result = checkReply({
      reply: 'Our Presidential Suite would suit you.',
      knowledge: knowledge(),
    });
    expect(result.flags).toContain('invented_room');
  });

  it('accepts the hotel’s real room names', () => {
    const result = checkReply({
      reply: 'We have a Deluxe Room and an Executive Room.',
      knowledge: knowledge(),
    });
    expect(result.flags).not.toContain('invented_room');
  });
});

describe('enforceGuardrails', () => {
  it('passes a compliant reply through unchanged', () => {
    const reply = 'Our Deluxe Room is ₹2,800 per night for 2 guests. Which dates are you looking at?';
    const result = enforceGuardrails({ reply, knowledge: knowledge() });
    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.text).toBe(reply);
  });

  it('replaces a violating reply with the hotel escalation message', () => {
    const hotel = knowledge();
    const result = enforceGuardrails({
      reply: 'Yes, the Deluxe Room is available and your booking is confirmed.',
      knowledge: hotel,
    });
    expect(result.blocked).toBe(true);
    expect(result.text).toBe(hotel.settings.aiEscalationMessage);
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it('blocks an empty reply', () => {
    const result = enforceGuardrails({ reply: '   ', knowledge: knowledge() });
    expect(result.blocked).toBe(true);
    expect(result.flags).toContain('empty_reply');
  });
});
