import type {
  BusinessSettings,
  Conversation,
  Customer,
  FollowUp,
  FollowUpRule,
  Lead,
} from '@/types/domain';
import { isTerminalLeadStatus } from '@/lib/leads/status';

/**
 * Follow-up decision engine.
 *
 * Pure logic: given the current state of a lead it decides whether another
 * automated follow-up is owed, which rule applies, and exactly when it is due.
 * Deciding and sending are deliberately separate so the rules can be reasoned
 * about and tested without touching the database or WhatsApp.
 *
 * Automation stops when: the customer replies, the lead converts or is lost,
 * a human takes over, the conversation is paused, the customer opts out, or
 * the configured maximum is reached.
 */

export interface FollowUpContext {
  lead: Lead;
  conversation: Conversation;
  customer: Customer;
  settings: BusinessSettings;
  rules: FollowUpRule[];
  existingFollowUps: FollowUp[];
  now: Date;
  /** IANA zone used for quiet-hours arithmetic. */
  timezone: string;
}

export interface ScheduleDecision {
  action: 'schedule';
  rule: FollowUpRule;
  sequenceIndex: number;
  scheduledFor: Date;
  dedupeKey: string;
  body: string;
}

export interface SkipDecision {
  action: 'skip';
  reason: SkipReason;
}

export type SkipReason =
  | 'follow_ups_disabled'
  | 'customer_opted_out'
  | 'lead_closed'
  | 'lead_paused'
  | 'conversation_not_ai'
  | 'limit_reached'
  | 'already_scheduled'
  | 'no_matching_rule'
  | 'rule_conditions_unmet'
  | 'no_trigger_timestamp';

export type FollowUpDecision = ScheduleDecision | SkipDecision;

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  follow_ups_disabled: 'Follow-ups are switched off for this hotel',
  customer_opted_out: 'Customer opted out of messages',
  lead_closed: 'Lead is already converted or lost',
  lead_paused: 'Lead is paused',
  conversation_not_ai: 'A staff member is handling this conversation',
  limit_reached: 'Follow-up limit reached for this lead',
  already_scheduled: 'A follow-up is already scheduled',
  no_matching_rule: 'No active rule for the next follow-up step',
  rule_conditions_unmet: 'Rule conditions are not met',
  no_trigger_timestamp: 'No timestamp to measure the delay from',
};

/**
 * Dedupe key for a follow-up.
 *
 * `revision` counts follow-ups already created for this sequence step. It stays
 * constant while a job is retried (making scheduling idempotent) but advances
 * once a follow-up is cancelled — so a customer who replies and then goes quiet
 * again can be followed up a second time without colliding with the cancelled
 * row.
 */
export function followUpDedupeKey(leadId: string, sequenceIndex: number, revision = 0): string {
  return `lead:${leadId}:seq:${sequenceIndex}:r${revision}`;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

/** Local hour in an IANA timezone, without pulling in a date library. */
export function hourInTimeZone(date: Date, timezone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(date);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Pushes a send time out of the hotel's quiet hours. Quiet windows may wrap
 * midnight (e.g. 21 → 8), so both cases are handled.
 */
export function applyQuietHours(
  target: Date,
  settings: Pick<BusinessSettings, 'quiet_hours_start' | 'quiet_hours_end'>,
  timezone: string,
): Date {
  const start = settings.quiet_hours_start;
  const end = settings.quiet_hours_end;
  if (start === null || end === null || start === undefined || end === undefined) return target;
  if (start === end) return target;

  const result = new Date(target.getTime());
  // Advance an hour at a time until out of the quiet window; bounded by a day.
  for (let step = 0; step < 24; step += 1) {
    const hour = hourInTimeZone(result, timezone);
    const inQuiet = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!inQuiet) return result;
    result.setUTCHours(result.getUTCHours() + 1, 0, 0, 0);
  }
  return result;
}

function conditionsMet(rule: FollowUpRule, context: FollowUpContext): boolean {
  const conditions = rule.conditions ?? {};
  if (conditions.lead_status_not_in?.includes(context.lead.status)) return false;
  if (conditions.conversation_mode && context.conversation.mode !== conditions.conversation_mode) {
    return false;
  }
  return true;
}

/**
 * Decides the next automated follow-up for a lead, if any.
 * Called after every inbound message and after every follow-up is sent.
 */
export function decideNextFollowUp(context: FollowUpContext): FollowUpDecision {
  const { lead, conversation, customer, settings, rules, existingFollowUps } = context;

  if (!settings.follow_ups_enabled) return { action: 'skip', reason: 'follow_ups_disabled' };
  if (customer.opted_out) return { action: 'skip', reason: 'customer_opted_out' };
  if (isTerminalLeadStatus(lead.status)) return { action: 'skip', reason: 'lead_closed' };
  if (lead.status === 'paused') return { action: 'skip', reason: 'lead_paused' };
  if (conversation.mode !== 'ai') return { action: 'skip', reason: 'conversation_not_ai' };

  const sent = existingFollowUps.filter((f) => f.status === 'sent');
  if (sent.length >= settings.max_follow_ups) return { action: 'skip', reason: 'limit_reached' };

  if (existingFollowUps.some((f) => f.status === 'scheduled')) {
    return { action: 'skip', reason: 'already_scheduled' };
  }

  const sequenceIndex = sent.length + 1;
  const rule = rules.find((r) => r.active && r.sequence_index === sequenceIndex);
  if (!rule) return { action: 'skip', reason: 'no_matching_rule' };
  if (!conditionsMet(rule, context)) return { action: 'skip', reason: 'rule_conditions_unmet' };

  const anchor = triggerAnchor(rule, lead, sent, context.now);
  if (!anchor) return { action: 'skip', reason: 'no_trigger_timestamp' };

  const rawTime = new Date(anchor.getTime() + rule.delay_minutes * 60_000);
  const scheduledFor = applyQuietHours(rawTime, settings, context.timezone);

  return {
    action: 'schedule',
    rule,
    sequenceIndex,
    scheduledFor,
    dedupeKey: followUpDedupeKey(
      lead.id,
      sequenceIndex,
      existingFollowUps.filter((f) => f.sequence_index === sequenceIndex).length,
    ),
    body: renderTemplate(rule.message_template, {
      customer_name: firstName(customer.name) ?? 'there',
      hotel_name: '',
    }).trim(),
  };
}

function triggerAnchor(
  rule: FollowUpRule,
  lead: Lead,
  sentFollowUps: FollowUp[],
  now: Date,
): Date | null {
  if (rule.trigger === 'previous_follow_up_sent') {
    const last = sentFollowUps
      .map((f) => f.sent_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return last ? new Date(last) : null;
  }
  // customer_inactive: measure from the customer's last message.
  const anchor = lead.last_customer_message_at ?? lead.created_at;
  return anchor ? new Date(anchor) : now;
}

function firstName(name: string | null): string | null {
  if (!name) return null;
  const part = name.trim().split(/\s+/)[0];
  return part && part.length > 1 ? part : null;
}

/** Reasons an already-scheduled follow-up must be cancelled. */
export type CancelReason =
  | 'customer_replied'
  | 'lead_converted'
  | 'lead_lost'
  | 'human_takeover'
  | 'conversation_paused'
  | 'customer_opted_out'
  | 'follow_ups_disabled'
  | 'cancelled_by_staff'
  | 'cancelled_by_ai';

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  customer_replied: 'Customer replied',
  lead_converted: 'Lead converted',
  lead_lost: 'Lead marked lost',
  human_takeover: 'Staff took over the conversation',
  conversation_paused: 'Conversation paused',
  customer_opted_out: 'Customer opted out',
  follow_ups_disabled: 'Follow-ups disabled',
  cancelled_by_staff: 'Cancelled by staff',
  cancelled_by_ai: 'Cancelled by the assistant',
};

/**
 * Guard applied immediately before sending. A follow-up scheduled 24 hours ago
 * may no longer be appropriate, so eligibility is re-checked at send time.
 */
export function isStillEligibleToSend(context: FollowUpContext, followUp: FollowUp): {
  eligible: boolean;
  reason?: SkipReason | CancelReason;
} {
  const { lead, conversation, customer, settings } = context;
  if (!settings.follow_ups_enabled) return { eligible: false, reason: 'follow_ups_disabled' };
  if (customer.opted_out) return { eligible: false, reason: 'customer_opted_out' };
  if (isTerminalLeadStatus(lead.status)) {
    return { eligible: false, reason: lead.status === 'converted' ? 'lead_converted' : 'lead_lost' };
  }
  if (lead.status === 'paused') return { eligible: false, reason: 'lead_paused' };
  if (conversation.mode === 'human') return { eligible: false, reason: 'human_takeover' };
  if (conversation.mode === 'paused') return { eligible: false, reason: 'conversation_paused' };

  // The customer wrote after this follow-up was scheduled: it is stale.
  const lastCustomerMessage = lead.last_customer_message_at;
  if (lastCustomerMessage && new Date(lastCustomerMessage) > new Date(followUp.created_at)) {
    return { eligible: false, reason: 'customer_replied' };
  }

  const sentCount = context.existingFollowUps.filter((f) => f.status === 'sent').length;
  if (sentCount >= settings.max_follow_ups) return { eligible: false, reason: 'limit_reached' };

  return { eligible: true };
}
