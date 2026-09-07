import { describe, expect, it } from 'vitest';
import {
  applyQuietHours,
  decideNextFollowUp,
  followUpDedupeKey,
  isStillEligibleToSend,
  renderTemplate,
  type FollowUpContext,
} from '@/lib/followups/engine';
import type { Conversation, Customer, FollowUp, Lead } from '@/types/domain';
import { MemoryStore } from './support/memory-store';
import { seedBusiness } from './support/fixtures';

const NOW = new Date('2026-09-07T10:00:00Z');

function buildContext(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  const store = new MemoryStore();
  const { business, settings, rules } = seedBusiness(store);

  const customer: Customer = {
    id: 'cust-1',
    business_id: business.id,
    phone_number: '919000000001',
    name: 'Rahul Sharma',
    email: null,
    language: null,
    notes: null,
    opted_out: false,
    opted_out_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };

  const conversation: Conversation = {
    id: 'conv-1',
    business_id: business.id,
    customer_id: customer.id,
    mode: 'ai',
    status: 'open',
    channel: 'whatsapp',
    assigned_staff_id: null,
    taken_over_by: null,
    taken_over_at: null,
    last_inbound_at: NOW.toISOString(),
    last_outbound_at: NOW.toISOString(),
    last_message_at: NOW.toISOString(),
    last_message_preview: null,
    unread_count: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };

  const lead: Lead = {
    id: 'lead-1',
    business_id: business.id,
    customer_id: customer.id,
    conversation_id: conversation.id,
    status: 'warm',
    temperature: 'warm',
    lead_score: 50,
    intent: 'pricing',
    estimated_value: 2800,
    expected_check_in: '2026-09-15',
    expected_check_out: null,
    guests: 2,
    room_preference: null,
    source: 'whatsapp',
    assigned_staff_id: null,
    follow_ups_sent: 0,
    last_customer_message_at: NOW.toISOString(),
    last_response_at: NOW.toISOString(),
    next_follow_up_at: null,
    converted_at: null,
    conversion_value: null,
    lost_at: null,
    loss_reason: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };

  return {
    lead,
    conversation,
    customer,
    settings,
    rules,
    existingFollowUps: [],
    now: NOW,
    timezone: business.timezone,
    ...overrides,
  };
}

function sentFollowUp(sequenceIndex: number, sentAt: string): FollowUp {
  return {
    id: `fu-${sequenceIndex}`,
    business_id: 'b',
    lead_id: 'lead-1',
    conversation_id: 'conv-1',
    rule_id: null,
    sequence_index: sequenceIndex,
    status: 'sent',
    scheduled_for: sentAt,
    sent_at: sentAt,
    cancelled_at: null,
    cancel_reason: null,
    message_id: null,
    body: null,
    attempts: 1,
    last_error: null,
    created_by: 'system',
    dedupe_key: followUpDedupeKey('lead-1', sequenceIndex),
    created_at: sentAt,
    updated_at: sentAt,
  };
}

describe('renderTemplate', () => {
  it('substitutes named variables and leaves unknown ones alone', () => {
    expect(renderTemplate('Hi {{customer_name}}, welcome', { customer_name: 'Rahul' })).toBe(
      'Hi Rahul, welcome',
    );
    expect(renderTemplate('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });
});

describe('decideNextFollowUp — scheduling', () => {
  it('schedules the first follow-up 24 hours after the customer went quiet', () => {
    const decision = decideNextFollowUp(buildContext());
    expect(decision.action).toBe('schedule');
    if (decision.action !== 'schedule') return;
    expect(decision.sequenceIndex).toBe(1);
    expect(decision.scheduledFor.toISOString()).toBe('2026-09-08T10:00:00.000Z');
    expect(decision.body).toContain('Rahul');
    expect(decision.dedupeKey).toBe(followUpDedupeKey('lead-1', 1));
  });

  it('schedules the second follow-up 48 hours after the first was sent', () => {
    const context = buildContext({
      existingFollowUps: [sentFollowUp(1, '2026-09-08T10:00:00.000Z')],
    });
    const decision = decideNextFollowUp(context);
    expect(decision.action).toBe('schedule');
    if (decision.action !== 'schedule') return;
    expect(decision.sequenceIndex).toBe(2);
    expect(decision.scheduledFor.toISOString()).toBe('2026-09-10T10:00:00.000Z');
  });
});

describe('decideNextFollowUp — stop conditions', () => {
  it('stops when follow-ups are switched off', () => {
    const context = buildContext();
    context.settings.follow_ups_enabled = false;
    expect(decideNextFollowUp(context)).toEqual({
      action: 'skip',
      reason: 'follow_ups_disabled',
    });
  });

  it('stops when the customer has opted out', () => {
    const context = buildContext();
    context.customer.opted_out = true;
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'customer_opted_out' });
  });

  it('stops for converted and lost leads', () => {
    for (const status of ['converted', 'lost'] as const) {
      const context = buildContext();
      context.lead.status = status;
      expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'lead_closed' });
    }
  });

  it('stops when a human is handling the conversation', () => {
    const context = buildContext();
    context.conversation.mode = 'human';
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'conversation_not_ai' });
  });

  it('stops when the conversation is paused', () => {
    const context = buildContext();
    context.conversation.mode = 'paused';
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'conversation_not_ai' });
  });

  it('stops at the configured maximum of two follow-ups', () => {
    const context = buildContext({
      existingFollowUps: [
        sentFollowUp(1, '2026-09-08T10:00:00.000Z'),
        sentFollowUp(2, '2026-09-10T10:00:00.000Z'),
      ],
    });
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'limit_reached' });
  });

  it('never double-schedules while one is already pending', () => {
    const pending: FollowUp = { ...sentFollowUp(1, NOW.toISOString()), status: 'scheduled' };
    const context = buildContext({ existingFollowUps: [pending] });
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'already_scheduled' });
  });

  it('stops when the rule for the next step is inactive', () => {
    const context = buildContext();
    for (const rule of context.rules) rule.active = false;
    expect(decideNextFollowUp(context)).toEqual({ action: 'skip', reason: 'no_matching_rule' });
  });
});

describe('quiet hours', () => {
  it('leaves a send time outside the quiet window untouched', () => {
    const target = new Date('2026-09-08T10:00:00Z'); // 15:30 IST
    const result = applyQuietHours(target, { quiet_hours_start: 21, quiet_hours_end: 8 }, 'Asia/Kolkata');
    expect(result.toISOString()).toBe(target.toISOString());
  });

  it('pushes a send inside the quiet window to after it ends', () => {
    const target = new Date('2026-09-08T18:00:00Z'); // 23:30 IST
    const result = applyQuietHours(target, { quiet_hours_start: 21, quiet_hours_end: 8 }, 'Asia/Kolkata');
    const hourIst = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(result),
    );
    expect(hourIst).toBeGreaterThanOrEqual(8);
    expect(hourIst).toBeLessThan(21);
  });

  it('is a no-op when quiet hours are not configured', () => {
    const target = new Date('2026-09-08T18:00:00Z');
    expect(
      applyQuietHours(target, { quiet_hours_start: null, quiet_hours_end: null }, 'Asia/Kolkata').toISOString(),
    ).toBe(target.toISOString());
  });
});

describe('isStillEligibleToSend', () => {
  const pending: FollowUp = {
    ...sentFollowUp(1, NOW.toISOString()),
    status: 'scheduled',
    created_at: '2026-09-07T10:00:00.000Z',
  };

  it('allows a send when nothing has changed', () => {
    expect(isStillEligibleToSend(buildContext(), pending).eligible).toBe(true);
  });

  it('refuses once the customer has replied since scheduling', () => {
    const context = buildContext();
    context.lead.last_customer_message_at = '2026-09-07T12:00:00.000Z';
    const result = isStillEligibleToSend(context, pending);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('customer_replied');
  });

  it('refuses after a human takes over', () => {
    const context = buildContext();
    context.conversation.mode = 'human';
    expect(isStillEligibleToSend(context, pending)).toEqual({
      eligible: false,
      reason: 'human_takeover',
    });
  });

  it('refuses once the lead converts', () => {
    const context = buildContext();
    context.lead.status = 'converted';
    expect(isStillEligibleToSend(context, pending)).toEqual({
      eligible: false,
      reason: 'lead_converted',
    });
  });
});
