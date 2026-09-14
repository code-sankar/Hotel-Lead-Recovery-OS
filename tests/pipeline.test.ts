import { describe, expect, it } from 'vitest';
import { processInboundMessage, type InboundPipelineDeps } from '@/lib/pipeline/inbound';
import { RulesAiProvider } from '@/lib/ai/rules-provider';
import { DemoMessagingProvider } from '@/lib/messaging/demo-provider';
import { executeFollowUp, runDueFollowUps, type FollowUpDeps } from '@/lib/followups/service';
import { MemoryStore } from './support/memory-store';
import { seedBusiness } from './support/fixtures';

/**
 * Integration coverage for the whole journey:
 * inbound message → conversation → lead → AI processing → outbound message →
 * follow-up scheduling → follow-up send → customer reply → conversion.
 */

function makeDeps(store: MemoryStore): InboundPipelineDeps & FollowUpDeps {
  const provider = new DemoMessagingProvider();
  return {
    store,
    ai: new RulesAiProvider(),
    resolveProvider: async () => provider,
  };
}

const PHONE = '919000000001';

describe('inbound pipeline', () => {
  it('turns a first enquiry into a conversation, a lead and a reply', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      profileName: 'Rahul Sharma',
      text: 'Hi, do you have a room for 15 Sept for 2 people?',
      providerMessageId: 'wamid.1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.outcome).toBe('processed');
    expect(result.conversationId).toBeDefined();
    expect(result.leadId).toBeDefined();
    expect(result.intent).toBe('room_availability');
    expect(result.simulated).toBe(true);

    const lead = store.leads[0]!;
    expect(lead.expected_check_in).toBe('2026-09-15');
    expect(lead.guests).toBe(2);
    expect(lead.lead_score).toBe(50);
    expect(lead.temperature).toBe('warm');

    // Inbound plus the assistant's reply.
    expect(store.messages).toHaveLength(2);
    const outbound = store.messages[1]!;
    expect(outbound.direction).toBe('outbound');
    expect(outbound.sender_type).toBe('ai');
    expect(outbound.delivery_status).toBe('simulated');
    expect(outbound.provider_message_id?.startsWith('demo:')).toBe(true);

    const eventTypes = store.leadEvents.map((e) => e.type);
    expect(eventTypes).toContain('lead_created');
    expect(eventTypes).toContain('intent_detected');
    expect(eventTypes).toContain('lead_scored');
    expect(eventTypes).toContain('ai_replied');
  });

  it('answers from hotel data without inventing availability', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'room hai? price kya hai?',
      providerMessageId: 'wamid.avail',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.guardrailFlags).toEqual([]);
    const reply = result.replyText ?? '';
    // Real prices from the hotel record...
    expect(reply).toContain('2,800');
    // ...and no promise that a room is free.
    expect(reply.toLowerCase()).toContain('confirm availability');
    expect(reply).not.toMatch(/yes,? we have .* available/i);
  });

  it('ignores a redelivered webhook instead of duplicating anything', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const input = {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Do you have rooms on 20 Sept?',
      providerMessageId: 'wamid.dup',
      now: new Date('2026-09-07T10:00:00Z'),
    };

    const first = await processInboundMessage(deps, input);
    const messagesAfterFirst = store.messages.length;
    const second = await processInboundMessage(deps, input);

    expect(first.outcome).toBe('processed');
    expect(second.outcome).toBe('duplicate');
    expect(store.messages).toHaveLength(messagesAfterFirst);
    expect(store.leads).toHaveLength(1);
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(1);
  });

  it('does not reply while a staff member has taken over', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'What are your room rates?',
      providerMessageId: 'wamid.a',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    const conversation = store.conversations[0]!;
    conversation.mode = 'human';
    const messagesBefore = store.messages.length;

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'And do you have parking?',
      providerMessageId: 'wamid.b',
      now: new Date('2026-09-07T10:05:00Z'),
    });

    expect(result.outcome).toBe('human_handling');
    // Only the inbound message was stored; the assistant stayed silent.
    expect(store.messages).toHaveLength(messagesBefore + 1);
    expect(store.messages.at(-1)!.direction).toBe('inbound');
    // The message was still analysed and scored for the staff member.
    expect(store.aiActions.at(-1)!.decision).toBe('human_handling');
  });

  it('does not reply when the assistant is switched off for the hotel', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store, { aiEnabled: false });
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Rates please',
      providerMessageId: 'wamid.off',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.outcome).toBe('ai_disabled');
    expect(store.messages.every((m) => m.direction === 'inbound')).toBe(true);
  });

  it('escalates complaints to a human and stops replying', async () => {
    const store = new MemoryStore();
    const { business, settings } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'The room was dirty last time, I want to complain and get a refund',
      providerMessageId: 'wamid.complaint',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.outcome).toBe('escalated');
    expect(result.replyText).toBe(settings.ai_escalation_message);
    expect(store.conversations[0]!.mode).toBe('human');
    expect(store.leadEvents.map((e) => e.type)).toContain('human_takeover');
  });

  it('honours an opt-out and cancels pending follow-ups', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'What is the price for a deluxe room?',
      providerMessageId: 'wamid.p1',
      now: new Date('2026-09-07T10:00:00Z'),
    });
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(1);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Please stop messaging me',
      providerMessageId: 'wamid.p2',
      now: new Date('2026-09-07T10:10:00Z'),
    });

    expect(store.customers[0]!.opted_out).toBe(true);
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(0);
    expect(store.leadEvents.map((e) => e.type)).toContain('customer_opted_out');
  });

  it('records a media-only message without trying to answer it', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: null,
      messageType: 'image',
      providerMessageId: 'wamid.img',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.outcome).toBe('no_text');
    expect(store.messages).toHaveLength(1);
  });
});

describe('availability', () => {
  it('answers with real numbers once dates are known, and the guardrails accept it', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Do you have a room for 15 Sept for 2 people?',
      providerMessageId: 'wamid.av1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.outcome).toBe('processed');
    expect(result.guardrailFlags).toEqual([]);

    const reply = result.replyText ?? '';
    // Demo hotel has 12 Deluxe rooms and nothing booked.
    expect(reply).toContain('12 rooms free');
    expect(reply).toContain('2026-09-15');
    // It no longer defers a question it can actually answer.
    expect(reply).not.toContain('do not have the live room chart');
  });

  it('says plainly that it is fully booked rather than inventing space', async () => {
    const store = new MemoryStore();
    const { business, knowledge } = seedBusiness(store);
    const deps = makeDeps(store);
    const customer = await store.findOrCreateCustomer({
      businessId: business.id,
      phoneNumber: '919000009999',
    });

    // Book out every unit of every room type for the night in question.
    for (const room of knowledge.rooms) {
      await store.createBooking({
        businessId: business.id,
        customerId: customer.id,
        roomId: room.id,
        checkIn: '2026-09-15',
        checkOut: '2026-09-16',
        units: room.totalUnits,
      });
    }

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Any room available on 15 Sept?',
      providerMessageId: 'wamid.av2',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.guardrailFlags).toEqual([]);
    expect(result.replyText?.toLowerCase()).toContain('fully booked');
    expect(result.replyText).not.toMatch(/\d+ rooms? free/);
  });

  it('still defers availability when no dates are known', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Do you have any rooms?',
      providerMessageId: 'wamid.av3',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(result.guardrailFlags).toEqual([]);
    expect(result.replyText?.toLowerCase()).toContain('confirm availability');
  });

  it('records what was verified on the AI action, so a reply can be audited', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Room for 15 Sept, 2 guests?',
      providerMessageId: 'wamid.av4',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    const action = store.aiActions.at(-1)!;
    expect(action.entities.availability_checked).toBe(true);
    expect(action.entities.availability_window).toBe('2026-09-15/2026-09-16');
    expect(action.entities.available_rooms).toContain('Deluxe Room');
  });

  it('only offers rooms that can seat the party', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    const result = await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Room for 15 Sept for 4 people?',
      providerMessageId: 'wamid.av5',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    // Only the Suite takes four guests.
    expect(result.replyText).toContain('Suite');
    expect(result.replyText).not.toContain('Deluxe Room');
    expect(result.guardrailFlags).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('never lets one hotel see or touch another hotel’s records', async () => {
    const store = new MemoryStore();
    const hotelA = seedBusiness(store, { name: 'Hotel A' });
    const hotelB = seedBusiness(store, { name: 'Hotel B' });
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: hotelA.business.id,
      phoneNumber: PHONE,
      text: 'Room for 15 Sept?',
      providerMessageId: 'wamid.a1',
      now: new Date('2026-09-07T10:00:00Z'),
    });
    await processInboundMessage(deps, {
      businessId: hotelB.business.id,
      phoneNumber: PHONE, // same customer number, different hotel
      text: 'Room for 20 Sept?',
      providerMessageId: 'wamid.b1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    expect(store.customers).toHaveLength(2);
    expect(store.conversations).toHaveLength(2);
    expect(store.leads).toHaveLength(2);

    const leadA = store.leads.find((l) => l.business_id === hotelA.business.id)!;
    const leadB = store.leads.find((l) => l.business_id === hotelB.business.id)!;

    expect(await store.getLead(hotelB.business.id, leadA.id)).toBeNull();
    expect(await store.getConversation(hotelA.business.id, leadB.conversation_id)).toBeNull();
    expect(await store.findMessageByProviderId(hotelB.business.id, 'wamid.a1')).toBeNull();
    expect(await store.listMessages(hotelA.business.id, leadB.conversation_id)).toEqual([]);
  });

  it('keeps the same phone number as two separate customers', async () => {
    const store = new MemoryStore();
    const hotelA = seedBusiness(store);
    const hotelB = seedBusiness(store);

    const a = await store.findOrCreateCustomer({
      businessId: hotelA.business.id,
      phoneNumber: PHONE,
      name: 'Rahul',
    });
    const b = await store.findOrCreateCustomer({
      businessId: hotelB.business.id,
      phoneNumber: PHONE,
      name: 'Rahul',
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('follow-up lifecycle', () => {
  it('schedules, sends, then chains the second follow-up', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      profileName: 'Rahul Sharma',
      text: 'How much for a deluxe room on 15 Sept?',
      providerMessageId: 'wamid.f1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    const scheduled = store.followUps.find((f) => f.status === 'scheduled')!;
    expect(scheduled.sequence_index).toBe(1);
    expect(new Date(scheduled.scheduled_for).toISOString()).toBe('2026-09-08T10:00:00.000Z');
    expect(scheduled.body).toContain('Rahul');

    // Nothing is due before its time.
    expect(await runDueFollowUps(deps, new Date('2026-09-07T23:00:00Z'))).toHaveLength(0);

    const outcomes = await runDueFollowUps(deps, new Date('2026-09-08T10:00:00Z'));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe('sent');

    const lead = store.leads[0]!;
    expect(lead.follow_ups_sent).toBe(1);
    expect(store.leadEvents.map((e) => e.type)).toContain('follow_up_sent');

    // The 48-hour nudge is chained from the send.
    const second = store.followUps.find((f) => f.sequence_index === 2)!;
    expect(second.status).toBe('scheduled');
    expect(new Date(second.scheduled_for).toISOString()).toBe('2026-09-10T10:00:00.000Z');
  });

  it('stops after the second follow-up', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Rates for 15 Sept?',
      providerMessageId: 'wamid.g1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    await runDueFollowUps(deps, new Date('2026-09-08T10:00:00Z'));
    await runDueFollowUps(deps, new Date('2026-09-10T10:00:00Z'));
    await runDueFollowUps(deps, new Date('2026-09-20T10:00:00Z'));

    expect(store.followUps.filter((f) => f.status === 'sent')).toHaveLength(2);
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(0);
    expect(store.leads[0]!.follow_ups_sent).toBe(2);
  });

  it('cancels the pending follow-up as soon as the customer replies', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Price for 15 Sept?',
      providerMessageId: 'wamid.h1',
      now: new Date('2026-09-07T10:00:00Z'),
    });
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(1);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Let me check and tell you',
      providerMessageId: 'wamid.h2',
      now: new Date('2026-09-07T11:00:00Z'),
    });

    const first = store.followUps.find((f) => f.sequence_index === 1)!;
    expect(first.status).toBe('cancelled');
    expect(first.cancel_reason).toBe('customer_replied');
    expect(store.leadEvents.map((e) => e.type)).toContain('follow_up_cancelled');
  });

  it('cancels rather than sends when a human took over in the meantime', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Rates for 15 Sept?',
      providerMessageId: 'wamid.i1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    store.conversations[0]!.mode = 'human';
    const pending = store.followUps.find((f) => f.status === 'scheduled')!;
    const outcome = await executeFollowUp(deps, pending, new Date('2026-09-08T10:00:00Z'));

    expect(outcome.status).toBe('cancelled');
    expect(outcome.reason).toBe('human_takeover');
    expect(store.messages.some((m) => m.sender_type === 'ai' && m.text?.includes('checking whether'))).toBe(
      false,
    );
  });

  it('never sends the same follow-up twice, even if the job is retried', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Rates for 15 Sept?',
      providerMessageId: 'wamid.j1',
      now: new Date('2026-09-07T10:00:00Z'),
    });

    const pending = store.followUps.find((f) => f.status === 'scheduled')!;
    const first = await executeFollowUp(deps, pending, new Date('2026-09-08T10:00:00Z'));
    const replay = await executeFollowUp(deps, pending, new Date('2026-09-08T10:00:00Z'));

    expect(first.status).toBe('sent');
    expect(replay.status).toBe('skipped');
    expect(store.followUps.filter((f) => f.sequence_index === 1)).toHaveLength(1);
  });
});

describe('the full recovery story', () => {
  it('runs enquiry → follow-up → reply → conversion end to end', async () => {
    const store = new MemoryStore();
    const { business } = seedBusiness(store);
    const deps = makeDeps(store);

    // Day 0 — the enquiry.
    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      profileName: 'Rahul Sharma',
      text: 'Hi, room available for 15 Sept?',
      providerMessageId: 'wamid.s1',
      now: new Date('2026-09-07T10:00:00Z'),
    });
    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: '2',
      providerMessageId: 'wamid.s2',
      now: new Date('2026-09-07T10:02:00Z'),
    });
    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Let me check and tell you',
      providerMessageId: 'wamid.s3',
      now: new Date('2026-09-07T10:05:00Z'),
    });

    let lead = store.leads[0]!;
    expect(lead.temperature).toBe('warm');
    expect(lead.guests).toBe(2);

    // Day 1 — the customer went quiet, so the follow-up goes out.
    const outcomes = await runDueFollowUps(deps, new Date('2026-09-08T10:05:00Z'));
    expect(outcomes[0]!.status).toBe('sent');
    const followUpMessage = store.messages.at(-1)!;
    expect(followUpMessage.direction).toBe('outbound');
    expect(followUpMessage.text).toContain('Rahul');

    // The customer comes back.
    await processInboundMessage(deps, {
      businessId: business.id,
      phoneNumber: PHONE,
      text: 'Yes, book it',
      providerMessageId: 'wamid.s4',
      now: new Date('2026-09-08T12:00:00Z'),
    });

    lead = store.leads[0]!;
    expect(lead.temperature).toBe('hot');
    expect(store.followUps.filter((f) => f.status === 'scheduled')).toHaveLength(0);

    // Staff take it from here and record the revenue.
    await store.updateLead(business.id, lead.id, {
      status: 'converted',
      converted_at: '2026-09-08T12:30:00Z',
      conversion_value: 5600,
    });
    await store.insertLeadEvent({
      businessId: business.id,
      leadId: lead.id,
      type: 'lead_converted',
      data: { value: 5600 },
    });

    const events = store.leadEvents.filter((e) => e.lead_id === lead.id).map((e) => e.type);
    expect(events).toContain('follow_up_sent');
    expect(events).toContain('lead_converted');
    expect(store.leads[0]!.conversion_value).toBe(5600);
  });
});
