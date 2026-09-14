import { describe, expect, it } from 'vitest';
import {
  availabilityUpdateSchema,
  convertLeadSchema,
  createBookingSchema,
  faqSchema,
  followUpRuleSchema,
  followUpSettingsSchema,
  policySchema,
  roomSchema,
  sendMessageSchema,
  signUpSchema,
  simulateInboundSchema,
  whatsappSettingsSchema,
} from '@/lib/validation/schemas';

/** Hotel data drives what the assistant is allowed to say, so it is validated hard. */
describe('room validation', () => {
  const valid = {
    name: 'Deluxe Room',
    description: 'Queen bed',
    basePrice: 2800,
    maxGuests: 2,
    totalUnits: 12,
    amenities: ['air conditioning'],
    breakfastIncluded: true,
    notes: '',
    active: true,
  };

  it('accepts a well-formed room', () => {
    expect(roomSchema.safeParse(valid).success).toBe(true);
  });

  it('coerces numeric strings from form data', () => {
    const result = roomSchema.safeParse({ ...valid, basePrice: '2800', maxGuests: '2', totalUnits: '12' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.basePrice).toBe(2800);
      expect(result.data.maxGuests).toBe(2);
      expect(result.data.totalUnits).toBe(12);
    }
  });

  it('allows zero rooms of a type, which reads as sold out rather than unlimited', () => {
    expect(roomSchema.safeParse({ ...valid, totalUnits: 0 }).success).toBe(true);
  });

  it('rejects a negative room count', () => {
    expect(roomSchema.safeParse({ ...valid, totalUnits: -1 }).success).toBe(false);
  });

  it('rejects a negative price', () => {
    expect(roomSchema.safeParse({ ...valid, basePrice: -100 }).success).toBe(false);
  });

  it('rejects zero or fractional guest counts', () => {
    expect(roomSchema.safeParse({ ...valid, maxGuests: 0 }).success).toBe(false);
    expect(roomSchema.safeParse({ ...valid, maxGuests: 2.5 }).success).toBe(false);
  });

  it('rejects a nameless room', () => {
    expect(roomSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
  });
});

describe('policy and FAQ validation', () => {
  it('requires a known policy type', () => {
    expect(
      policySchema.safeParse({ type: 'cancellation', content: 'Free up to 48 hours.', active: true })
        .success,
    ).toBe(true);
    expect(
      policySchema.safeParse({ type: 'made_up', content: 'Something.', active: true }).success,
    ).toBe(false);
  });

  it('rejects empty policy or FAQ text', () => {
    expect(policySchema.safeParse({ type: 'pet', content: '', active: true }).success).toBe(false);
    expect(faqSchema.safeParse({ question: 'Parking?', answer: '', active: true }).success).toBe(false);
  });
});

describe('follow-up validation', () => {
  it('caps automated follow-ups at five', () => {
    expect(
      followUpSettingsSchema.safeParse({
        followUpsEnabled: true,
        maxFollowUps: 6,
        quietHoursStart: null,
        quietHoursEnd: null,
      }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range quiet hour', () => {
    expect(
      followUpSettingsSchema.safeParse({
        followUpsEnabled: true,
        maxFollowUps: 2,
        quietHoursStart: 24,
        quietHoursEnd: 8,
      }).success,
    ).toBe(false);
  });

  it('refuses a follow-up delay short enough to feel like spam', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'First follow-up',
      messageTemplate: 'Hi {{customer_name}}, just checking in.',
      active: true,
    };
    expect(followUpRuleSchema.safeParse({ ...base, delayMinutes: 5 }).success).toBe(false);
    expect(followUpRuleSchema.safeParse({ ...base, delayMinutes: 1440 }).success).toBe(true);
  });
});

describe('availability validation', () => {
  const base = {
    roomId: null,
    from: '2026-09-15',
    to: '2026-09-17',
    action: 'close' as const,
  };

  it('accepts a closure across a range', () => {
    expect(availabilityUpdateSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a range that runs backwards', () => {
    expect(
      availabilityUpdateSchema.safeParse({ ...base, from: '2026-09-17', to: '2026-09-15' }).success,
    ).toBe(false);
  });

  it('allows a single day', () => {
    expect(availabilityUpdateSchema.safeParse({ ...base, to: '2026-09-15' }).success).toBe(true);
  });

  it('requires a number when setting rooms available', () => {
    expect(availabilityUpdateSchema.safeParse({ ...base, action: 'set_units' }).success).toBe(false);
    expect(
      availabilityUpdateSchema.safeParse({ ...base, action: 'set_units', units: 3 }).success,
    ).toBe(true);
  });

  it('allows setting zero rooms available', () => {
    expect(
      availabilityUpdateSchema.safeParse({ ...base, action: 'set_units', units: 0 }).success,
    ).toBe(true);
  });

  it('rejects malformed dates rather than guessing', () => {
    expect(availabilityUpdateSchema.safeParse({ ...base, from: '15 Sept' }).success).toBe(false);
  });
});

describe('booking validation', () => {
  const base = {
    leadId: '00000000-0000-4000-8000-000000000000',
    roomId: '00000000-0000-4000-8000-000000000001',
    checkIn: '2026-09-15',
    checkOut: '2026-09-17',
    units: 1,
  };

  it('accepts a stay of at least one night', () => {
    expect(createBookingSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a zero-night stay', () => {
    expect(createBookingSchema.safeParse({ ...base, checkOut: '2026-09-15' }).success).toBe(false);
  });

  it('rejects a checkout before check-in', () => {
    expect(createBookingSchema.safeParse({ ...base, checkOut: '2026-09-14' }).success).toBe(false);
  });

  it('rejects zero rooms', () => {
    expect(createBookingSchema.safeParse({ ...base, units: 0 }).success).toBe(false);
  });
});

describe('action input validation', () => {
  it('requires a uuid conversation id and non-empty text', () => {
    expect(sendMessageSchema.safeParse({ conversationId: 'nope', text: 'Hello' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        conversationId: '00000000-0000-4000-8000-000000000000',
        text: '   ',
      }).success,
    ).toBe(false);
  });

  it('rejects a negative conversion value', () => {
    expect(
      convertLeadSchema.safeParse({
        leadId: '00000000-0000-4000-8000-000000000000',
        conversionValue: -1,
      }).success,
    ).toBe(false);
  });

  it('requires a plausible phone number for simulated inbound messages', () => {
    const base = { businessId: '00000000-0000-4000-8000-000000000000', text: 'Hi' };
    expect(simulateInboundSchema.safeParse({ ...base, phoneNumber: '919810000101' }).success).toBe(true);
    expect(simulateInboundSchema.safeParse({ ...base, phoneNumber: '12' }).success).toBe(false);
    expect(simulateInboundSchema.safeParse({ ...base, phoneNumber: '+91 98100' }).success).toBe(false);
  });

  it('only allows the two documented messaging modes', () => {
    const base = { messagingMode: 'demo' };
    expect(whatsappSettingsSchema.safeParse(base).success).toBe(true);
    expect(whatsappSettingsSchema.safeParse({ messagingMode: 'live' }).success).toBe(true);
    expect(whatsappSettingsSchema.safeParse({ messagingMode: 'whatsapp-web' }).success).toBe(false);
  });

  it('enforces a minimum password length at signup', () => {
    const base = { fullName: 'Asha Verma', email: 'asha@example.com' };
    expect(signUpSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: 'longenough1' }).success).toBe(true);
  });

  it('normalises email case', () => {
    const result = signUpSchema.safeParse({
      fullName: 'Asha Verma',
      email: '  Asha@Example.COM ',
      password: 'longenough1',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('asha@example.com');
  });
});
