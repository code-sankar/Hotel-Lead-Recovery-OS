import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceStore } from '@/lib/db/supabase-store';
import { createAiProvider } from '@/lib/ai';
import { RulesAiProvider } from '@/lib/ai/rules-provider';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { processInboundMessage, type InboundPipelineDeps } from '@/lib/pipeline/inbound';
import { executeFollowUp, type FollowUpDeps } from '@/lib/followups/service';
import {
  DEMO_ESCALATION_MESSAGE,
  DEMO_FAQS,
  DEMO_HOTEL,
  DEMO_POLICIES,
  DEMO_ROOMS,
  DEMO_WELCOME_MESSAGE,
} from './data';

/**
 * Demo data.
 *
 * Everything here goes through the REAL pipeline: a demo conversation is
 * produced by the same inbound processing, scoring, guardrails and follow-up
 * engine that a live WhatsApp message would use. Only the transport is
 * simulated, and those messages are stored with delivery_status `simulated`.
 *
 * The guests are invented. No real personal data is used.
 */

export interface SeedOptions {
  /** Use the deterministic engine even when an OpenAI key is present, so seeding is fast and free. */
  useRulesEngine?: boolean;
  now?: Date;
}

export interface SeedResult {
  hotelContent: { rooms: number; policies: number; faqs: number };
  customers: number;
  conversations: number;
  followUpsSent: number;
  conversions: number;
}

interface DemoGuest {
  name: string;
  phone: string;
  /** Messages in order, each processed as a separate inbound message. */
  messages: string[];
  /** Simulate the guest going quiet, then run the due follow-up. */
  goesQuiet?: boolean;
  /** Message sent after the follow-up lands. */
  replyAfterFollowUp?: string;
  outcome?: { type: 'converted'; value: number } | { type: 'lost'; reason: string };
  takeover?: boolean;
}

/**
 * Twelve invented guests covering every lead state a hotel owner needs to see:
 * new, cold, warm, hot, followed up, recovered, converted, lost and taken over.
 */
const DEMO_GUESTS: DemoGuest[] = [
  { name: 'Rahul Sharma', phone: '919810000101', messages: ['Hi, room available for 15 Sept?', '2'] },
  {
    name: 'Priya Nair',
    phone: '919810000102',
    messages: ['How much for a deluxe room on 22 Sept for 2 people?'],
    goesQuiet: true,
  },
  {
    name: 'Amit Bora',
    phone: '919810000103',
    messages: ['Do you have rooms for 18 Sept? 2 adults', 'What is the price?', 'Yes, book it'],
    outcome: { type: 'converted', value: 5600 },
  },
  {
    name: 'Sameer Dutta',
    phone: '919810000104',
    messages: ['I need a room tonight but the last stay had an issue, I want to complain'],
    takeover: true,
  },
  {
    name: 'Kavita Deka',
    phone: '919810000105',
    messages: ['price kya hai deluxe room ka?'],
    goesQuiet: true,
    replyAfterFollowUp: 'Yes please, book it for 25 Sept',
    outcome: { type: 'converted', value: 8400 },
  },
  { name: 'Nikhil Gogoi', phone: '919810000106', messages: ['Is parking available?'] },
  { name: 'Meera Iyer', phone: '919810000107', messages: ['room hai 30 Sept ko? 3 person'] },
  {
    name: 'Arjun Saikia',
    phone: '919810000108',
    messages: ['What is your best price for 2 nights from 12 Oct?'],
    goesQuiet: true,
  },
  {
    name: 'Farhan Ali',
    phone: '919810000109',
    messages: ['Just checking rates for now, comparing a few hotels'],
    outcome: { type: 'lost', reason: 'Booked elsewhere' },
  },
  { name: 'Ritu Barman', phone: '919810000110', messages: ['Is breakfast included?', 'And is Wi-Fi free?'] },
  {
    name: 'Deepak Rajkhowa',
    phone: '919810000111',
    messages: ['We need 10 rooms for a conference in November'],
  },
  { name: 'Sneha Kalita', phone: '919810000112', messages: ['Where is the hotel located?'] },
];

/** Fills a hotel's knowledge tables with the demo hotel, without overwriting real content. */
export async function seedHotelContent(
  client: SupabaseClient,
  businessId: string,
): Promise<SeedResult['hotelContent']> {
  await client
    .from('businesses')
    .update({
      address: DEMO_HOTEL.address,
      city: DEMO_HOTEL.city,
      state: DEMO_HOTEL.state,
      country: DEMO_HOTEL.country,
      phone: DEMO_HOTEL.phone,
      website: DEMO_HOTEL.website,
      timezone: DEMO_HOTEL.timezone,
      currency: DEMO_HOTEL.currency,
      is_demo: true,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', businessId);

  await client.from('business_profiles').upsert(
    {
      business_id: businessId,
      description: DEMO_HOTEL.description,
      location_note: DEMO_HOTEL.locationNote,
      landmarks: DEMO_HOTEL.landmarks,
      check_in_time: DEMO_HOTEL.checkInTime,
      check_out_time: DEMO_HOTEL.checkOutTime,
      amenities: [...DEMO_HOTEL.amenities],
      business_hours: { ...DEMO_HOTEL.businessHours },
    },
    { onConflict: 'business_id' },
  );

  await client
    .from('business_settings')
    .update({
      ai_welcome_message: DEMO_WELCOME_MESSAGE,
      ai_escalation_message: DEMO_ESCALATION_MESSAGE,
    })
    .eq('business_id', businessId);

  const counts = { rooms: 0, policies: 0, faqs: 0 };

  const { count: existingRooms } = await client
    .from('rooms')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);
  if (!existingRooms) {
    const { data } = await client
      .from('rooms')
      .insert(
        DEMO_ROOMS.map((room) => ({
          business_id: businessId,
          name: room.name,
          description: room.description,
          base_price: room.basePrice,
          max_guests: room.maxGuests,
          total_units: room.totalUnits,
          amenities: room.amenities,
          breakfast_included: room.breakfastIncluded,
          notes: room.notes,
          sort_order: room.sortOrder,
        })),
      )
      .select('id');
    counts.rooms = data?.length ?? 0;
  }

  const { count: existingPolicies } = await client
    .from('hotel_policies')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);
  if (!existingPolicies) {
    const { data } = await client
      .from('hotel_policies')
      .insert(
        DEMO_POLICIES.map((policy) => ({
          business_id: businessId,
          type: policy.type,
          title: policy.title,
          content: policy.content,
        })),
      )
      .select('id');
    counts.policies = data?.length ?? 0;
  }

  const { count: existingFaqs } = await client
    .from('hotel_faqs')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);
  if (!existingFaqs) {
    const { data } = await client
      .from('hotel_faqs')
      .insert(
        DEMO_FAQS.map((faq) => ({
          business_id: businessId,
          question: faq.question,
          answer: faq.answer,
          sort_order: faq.sortOrder,
        })),
      )
      .select('id');
    counts.faqs = data?.length ?? 0;
  }

  return counts;
}

/**
 * Rewinds a lead so its pending follow-up is due now. Used by the demo to
 * compress "the guest went quiet for a day" into a click.
 */
export async function simulateInactivity(
  client: SupabaseClient,
  businessId: string,
  leadId: string,
  hours = 25,
): Promise<void> {
  const shiftMs = hours * 60 * 60 * 1000;
  const shift = (iso: string | null): string | null =>
    iso ? new Date(new Date(iso).getTime() - shiftMs).toISOString() : null;

  const { data: lead } = await client
    .from('leads')
    .select('id, conversation_id, last_customer_message_at, created_at')
    .eq('business_id', businessId)
    .eq('id', leadId)
    .single();
  if (!lead) return;

  await client
    .from('leads')
    .update({
      last_customer_message_at: shift(lead.last_customer_message_at as string | null),
      created_at: shift(lead.created_at as string),
    })
    .eq('business_id', businessId)
    .eq('id', leadId);

  const { data: conversation } = await client
    .from('conversations')
    .select('last_inbound_at, last_message_at')
    .eq('business_id', businessId)
    .eq('id', lead.conversation_id as string)
    .single();

  if (conversation) {
    await client
      .from('conversations')
      .update({
        last_inbound_at: shift(conversation.last_inbound_at as string | null),
        last_message_at: shift(conversation.last_message_at as string | null),
      })
      .eq('business_id', businessId)
      .eq('id', lead.conversation_id as string);
  }

  // Existing messages are moved back too, so the thread reads chronologically.
  const { data: messages } = await client
    .from('messages')
    .select('id, created_at')
    .eq('business_id', businessId)
    .eq('conversation_id', lead.conversation_id as string);
  for (const message of (messages ?? []) as Array<{ id: string; created_at: string }>) {
    await client
      .from('messages')
      .update({ created_at: shift(message.created_at) })
      .eq('business_id', businessId)
      .eq('id', message.id);
  }

  await client
    .from('follow_ups')
    .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq('business_id', businessId)
    .eq('lead_id', leadId)
    .eq('status', 'scheduled');

  const { data: pending } = await client
    .from('follow_ups')
    .select('id, created_at')
    .eq('business_id', businessId)
    .eq('lead_id', leadId)
    .eq('status', 'scheduled');
  for (const followUp of (pending ?? []) as Array<{ id: string; created_at: string }>) {
    await client
      .from('follow_ups')
      .update({ created_at: shift(followUp.created_at) })
      .eq('business_id', businessId)
      .eq('id', followUp.id);
  }
}

export async function seedDemoConversations(
  client: SupabaseClient,
  businessId: string,
  options: SeedOptions = {},
): Promise<Omit<SeedResult, 'hotelContent'>> {
  const store = getServiceStore();
  const ai = options.useRulesEngine ? new RulesAiProvider() : createAiProvider();
  const resolveProvider = async (id: string) => (await resolveMessagingProvider(store, id)).provider;

  const pipelineDeps: InboundPipelineDeps = { store, ai, resolveProvider };
  const followUpDeps: FollowUpDeps = { store, resolveProvider };

  let customers = 0;
  let conversations = 0;
  let followUpsSent = 0;
  let conversions = 0;

  for (const guest of DEMO_GUESTS) {
    let leadId: string | undefined;

    for (const [index, text] of guest.messages.entries()) {
      const result = await processInboundMessage(pipelineDeps, {
        businessId,
        phoneNumber: guest.phone,
        profileName: guest.name,
        text,
        providerMessageId: `demo-seed:${guest.phone}:${index}`,
      });
      leadId ??= result.leadId;
      if (index === 0) {
        customers += 1;
        conversations += 1;
      }
    }

    if (!leadId) continue;

    if (guest.goesQuiet) {
      await simulateInactivity(client, businessId, leadId);
      const due = await store.listFollowUpsForLead(businessId, leadId);
      const pending = due.find((followUp) => followUp.status === 'scheduled');
      if (pending) {
        const outcome = await executeFollowUp(followUpDeps, pending);
        if (outcome.status === 'sent') followUpsSent += 1;
      }
    }

    if (guest.replyAfterFollowUp) {
      await processInboundMessage(pipelineDeps, {
        businessId,
        phoneNumber: guest.phone,
        profileName: guest.name,
        text: guest.replyAfterFollowUp,
        providerMessageId: `demo-seed:${guest.phone}:reply`,
      });
    }

    if (guest.takeover) {
      const lead = await store.getLead(businessId, leadId);
      if (lead) {
        await store.updateConversation(businessId, lead.conversation_id, { mode: 'human' });
      }
    }

    if (guest.outcome?.type === 'converted') {
      const now = new Date().toISOString();
      await store.updateLead(businessId, leadId, {
        status: 'converted',
        converted_at: now,
        conversion_value: guest.outcome.value,
        next_follow_up_at: null,
      });
      await store.cancelScheduledFollowUps(businessId, leadId, 'lead_converted');
      await store.insertLeadEvent({
        businessId,
        leadId,
        type: 'lead_converted',
        actorType: 'staff',
        data: { value: guest.outcome.value, demo: true },
      });
      await store.insertAnalyticsEvent({
        businessId,
        type: 'lead_converted',
        leadId,
        value: guest.outcome.value,
        occurredAt: now,
      });
      conversions += 1;
    }

    if (guest.outcome?.type === 'lost') {
      await store.updateLead(businessId, leadId, {
        status: 'lost',
        lost_at: new Date().toISOString(),
        loss_reason: guest.outcome.reason,
        next_follow_up_at: null,
      });
      await store.cancelScheduledFollowUps(businessId, leadId, 'lead_lost');
      await store.insertLeadEvent({
        businessId,
        leadId,
        type: 'lead_lost',
        actorType: 'staff',
        data: { reason: guest.outcome.reason, demo: true },
      });
    }
  }

  return { customers, conversations, followUpsSent, conversions };
}

function isoDaysFromNow(days: number, now: Date): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Gives the demo hotel a realistic inventory picture: mostly open, one room
 * type sold out over a weekend, and a maintenance closure. Without this the
 * demo would only ever show "plenty free", which is the easy case.
 */
export async function seedDemoAvailability(
  client: SupabaseClient,
  businessId: string,
  now: Date = new Date(),
): Promise<{ overrides: number; bookings: number }> {
  const { data: roomRows } = await client
    .from('rooms')
    .select('id, name, total_units')
    .eq('business_id', businessId)
    .eq('active', true);

  const rooms = (roomRows ?? []) as Array<{ id: string; name: string; total_units: number }>;
  if (rooms.length === 0) return { overrides: 0, bookings: 0 };

  const suite = rooms.find((room) => room.name.toLowerCase().includes('suite'));
  const deluxe = rooms.find((room) => room.name.toLowerCase().includes('deluxe'));

  const overrides: Array<Record<string, unknown>> = [];

  // The whole hotel is closed for one day of maintenance next week.
  const maintenance = isoDaysFromNow(9, now);
  for (const room of rooms) {
    overrides.push({
      business_id: businessId,
      room_id: room.id,
      date: maintenance,
      closed: true,
      units_available: null,
      note: 'Annual maintenance',
    });
  }

  // The Deluxe allotment is trimmed over a busy weekend.
  if (deluxe) {
    for (const offset of [5, 6]) {
      overrides.push({
        business_id: businessId,
        room_id: deluxe.id,
        date: isoDaysFromNow(offset, now),
        closed: false,
        units_available: 3,
        note: 'Block held for a tour group',
      });
    }
  }

  if (overrides.length > 0) {
    await client
      .from('room_availability')
      .upsert(overrides, { onConflict: 'business_id,room_id,date' });
  }

  // One confirmed stay takes the Suite out entirely for two nights, so the demo
  // shows a genuine sold-out answer rather than only the happy path.
  let bookings = 0;
  if (suite) {
    const { data: customer } = await client
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .limit(1)
      .maybeSingle();

    if (customer) {
      const { error } = await client.from('bookings').insert({
        business_id: businessId,
        customer_id: (customer as { id: string }).id,
        room_id: suite.id,
        check_in: isoDaysFromNow(3, now),
        check_out: isoDaysFromNow(5, now),
        units: suite.total_units,
        total_value: 11_000,
        notes: 'Demo booking — blocks the Suite so availability shows a sold-out case.',
      });
      if (!error) bookings = 1;
    }
  }

  return { overrides: overrides.length, bookings };
}

export async function seedDemoBusiness(
  client: SupabaseClient,
  businessId: string,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const hotelContent = await seedHotelContent(client, businessId);
  const rest = await seedDemoConversations(client, businessId, options);
  // Seeded after the conversations, so a customer exists to attach the demo
  // booking to.
  await seedDemoAvailability(client, businessId, options.now ?? new Date());
  return { hotelContent, ...rest };
}

export { DEMO_GUESTS };
