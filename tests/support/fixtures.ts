import { randomUUID } from 'node:crypto';
import type { Business, BusinessSettings, FollowUpRule } from '@/types/domain';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import {
  DEMO_ESCALATION_MESSAGE,
  DEMO_FAQS,
  DEMO_HOTEL,
  DEMO_POLICIES,
  DEMO_ROOMS,
  DEMO_WELCOME_MESSAGE,
} from '@/lib/demo/data';
import { DEFAULT_TEMPLATE_PURPOSES } from '@/lib/messaging/templates';
import type { MemoryStore } from './memory-store';

export interface SeededBusiness {
  business: Business;
  knowledge: HotelKnowledge;
  settings: BusinessSettings;
  rules: FollowUpRule[];
}

export function seedBusiness(
  store: MemoryStore,
  overrides: {
    name?: string;
    phoneNumberId?: string;
    aiEnabled?: boolean;
    followUpsEnabled?: boolean;
    maxFollowUps?: number;
  } = {},
): SeededBusiness {
  const id = randomUUID();
  const now = new Date().toISOString();

  const business: Business = {
    id,
    name: overrides.name ?? DEMO_HOTEL.name,
    slug: null,
    logo_url: null,
    address: DEMO_HOTEL.address,
    city: DEMO_HOTEL.city,
    state: DEMO_HOTEL.state,
    country: DEMO_HOTEL.country,
    phone: DEMO_HOTEL.phone,
    website: DEMO_HOTEL.website,
    timezone: DEMO_HOTEL.timezone,
    currency: DEMO_HOTEL.currency,
    messaging_mode: 'demo',
    is_demo: true,
    onboarding_completed_at: now,
    created_by: null,
    created_at: now,
    updated_at: now,
  };
  store.businesses.set(id, business);

  const knowledge: HotelKnowledge = {
    business: {
      id,
      name: business.name,
      address: business.address,
      city: business.city,
      state: business.state,
      phone: business.phone,
      website: business.website,
      currency: business.currency,
      timezone: business.timezone,
    },
    profile: {
      description: DEMO_HOTEL.description,
      locationNote: DEMO_HOTEL.locationNote,
      checkInTime: DEMO_HOTEL.checkInTime,
      checkOutTime: DEMO_HOTEL.checkOutTime,
      amenities: [...DEMO_HOTEL.amenities],
      businessHours: { ...DEMO_HOTEL.businessHours },
      landmarks: DEMO_HOTEL.landmarks,
    },
    rooms: DEMO_ROOMS.map((room) => ({
      id: randomUUID(),
      name: room.name,
      description: room.description,
      basePrice: room.basePrice,
      maxGuests: room.maxGuests,
      amenities: room.amenities,
      breakfastIncluded: room.breakfastIncluded,
      notes: room.notes,
      totalUnits: room.totalUnits,
    })),
    policies: DEMO_POLICIES.map((policy) => ({
      type: policy.type,
      title: policy.title,
      content: policy.content,
    })),
    faqs: DEMO_FAQS.map((faq) => ({ question: faq.question, answer: faq.answer })),
    settings: {
      aiTone: 'friendly_professional',
      aiWelcomeMessage: DEMO_WELCOME_MESSAGE,
      aiEscalationMessage: DEMO_ESCALATION_MESSAGE,
    },
  };
  store.knowledge.set(id, knowledge);

  const settings: BusinessSettings = {
    business_id: id,
    ai_enabled: overrides.aiEnabled ?? true,
    ai_tone: 'friendly_professional',
    ai_welcome_message: DEMO_WELCOME_MESSAGE,
    ai_escalation_message: DEMO_ESCALATION_MESSAGE,
    follow_ups_enabled: overrides.followUpsEnabled ?? true,
    max_follow_ups: overrides.maxFollowUps ?? 2,
    quiet_hours_start: null,
    quiet_hours_end: null,
    updated_at: now,
  };
  store.settings.set(id, settings);

  const rules: FollowUpRule[] = [
    {
      id: randomUUID(),
      business_id: id,
      name: 'First follow-up — no reply',
      trigger: 'customer_inactive',
      delay_minutes: 1440,
      sequence_index: 1,
      conditions: { lead_status_not_in: ['converted', 'lost', 'paused'], conversation_mode: 'ai' },
      message_template:
        'Hi {{customer_name}}, just checking whether you had a chance to look at the room options. Happy to help with the booking whenever you are ready.',
      whatsapp_template_purpose: 'follow_up_1',
      active: true,
    },
    {
      id: randomUUID(),
      business_id: id,
      name: 'Second follow-up — still quiet',
      trigger: 'previous_follow_up_sent',
      delay_minutes: 2880,
      sequence_index: 2,
      conditions: { lead_status_not_in: ['converted', 'lost', 'paused'], conversation_mode: 'ai' },
      message_template:
        'We are happy to help with your stay whenever you are ready. Would you like me to keep your enquiry open?',
      whatsapp_template_purpose: 'follow_up_2',
      active: true,
    },
  ];
  store.followUpRules.push(...rules);

  store.templates.push(
    ...DEFAULT_TEMPLATE_PURPOSES.map((purpose) => ({
      id: randomUUID(),
      business_id: id,
      purpose,
      template_name: `leadstay_${purpose}`,
      language_code: 'en',
      body_preview: null,
      variable_map: [],
      active: true,
    })),
  );

  if (overrides.phoneNumberId) {
    store.integrations.set(id, {
      business_id: id,
      phone_number_id: overrides.phoneNumberId,
      display_phone_number: '+91 373 230 0100',
      waba_id: 'waba-demo',
      access_token: null,
      app_secret: 'test-app-secret',
      verify_token: 'test-verify-token',
      status: 'configured',
    });
  }

  return { business, knowledge, settings, rules };
}
