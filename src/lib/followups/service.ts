import type { Business, FollowUp, Lead } from '@/types/domain';
import type { Store } from '@/lib/db/store';
import type { MessagingProvider } from '@/lib/messaging/types';
import { sendOutboundMessage } from '@/lib/pipeline/outbound';
import { logError } from '@/lib/monitoring/logger';
import { statusForTemperature } from '@/lib/leads/status';
import {
  decideNextFollowUp,
  isStillEligibleToSend,
  type CancelReason,
  type FollowUpContext,
  type FollowUpDecision,
} from './engine';

/**
 * Applies the follow-up engine's decisions against the database and the
 * messaging provider. All scheduling is idempotent through the dedupe key, so
 * a retried job re-uses the existing row instead of creating a second one.
 */

export interface FollowUpDeps {
  store: Store;
  resolveProvider: (businessId: string) => Promise<MessagingProvider>;
}

async function loadContext(
  store: Store,
  lead: Lead,
  now: Date,
): Promise<FollowUpContext | null> {
  const [business, conversation, customer, settings, rules, existingFollowUps] = await Promise.all([
    store.getBusiness(lead.business_id),
    store.getConversation(lead.business_id, lead.conversation_id),
    store.getCustomer(lead.business_id, lead.customer_id),
    store.getSettings(lead.business_id),
    store.listFollowUpRules(lead.business_id),
    store.listFollowUpsForLead(lead.business_id, lead.id),
  ]);

  if (!business || !conversation || !customer || !settings) return null;

  return {
    lead,
    conversation,
    customer,
    settings,
    rules,
    existingFollowUps,
    now,
    timezone: business.timezone,
  };
}

export interface ScheduleOutcome {
  decision: FollowUpDecision;
  followUp: FollowUp | null;
}

/** Schedules the next follow-up for a lead if the rules say one is owed. */
export async function scheduleNextFollowUp(
  deps: FollowUpDeps,
  lead: Lead,
  now: Date = new Date(),
): Promise<ScheduleOutcome> {
  const context = await loadContext(deps.store, lead, now);
  if (!context) return { decision: { action: 'skip', reason: 'no_matching_rule' }, followUp: null };

  const decision = decideNextFollowUp(context);
  if (decision.action === 'skip') return { decision, followUp: null };

  const existing = await deps.store.findFollowUpByDedupeKey(lead.business_id, decision.dedupeKey);
  if (existing) {
    return { decision: { action: 'skip', reason: 'already_scheduled' }, followUp: existing };
  }

  const followUp = await deps.store.createFollowUp({
    businessId: lead.business_id,
    leadId: lead.id,
    conversationId: lead.conversation_id,
    ruleId: decision.rule.id,
    sequenceIndex: decision.sequenceIndex,
    scheduledFor: decision.scheduledFor.toISOString(),
    body: decision.body,
    dedupeKey: decision.dedupeKey,
    createdBy: 'system',
  });

  await deps.store.updateLead(lead.business_id, lead.id, {
    next_follow_up_at: decision.scheduledFor.toISOString(),
  });

  await deps.store.insertLeadEvent({
    businessId: lead.business_id,
    leadId: lead.id,
    type: 'follow_up_scheduled',
    data: {
      follow_up_id: followUp.id,
      rule: decision.rule.name,
      sequence_index: decision.sequenceIndex,
      scheduled_for: decision.scheduledFor.toISOString(),
    },
  });

  return { decision, followUp };
}

/** Cancels every scheduled follow-up for a lead and logs why. */
export async function cancelFollowUpsForLead(
  deps: FollowUpDeps,
  lead: Pick<Lead, 'id' | 'business_id'>,
  reason: CancelReason,
): Promise<FollowUp[]> {
  const cancelled = await deps.store.cancelScheduledFollowUps(lead.business_id, lead.id, reason);
  if (cancelled.length === 0) return [];

  await deps.store.updateLead(lead.business_id, lead.id, { next_follow_up_at: null });
  await deps.store.insertLeadEvent({
    businessId: lead.business_id,
    leadId: lead.id,
    type: 'follow_up_cancelled',
    data: { reason, cancelled: cancelled.length },
  });
  return cancelled;
}

export interface ExecuteOutcome {
  status: 'sent' | 'cancelled' | 'skipped' | 'failed';
  reason?: string;
  followUpId: string;
}

/**
 * Sends one due follow-up. Eligibility is re-checked here because the world
 * may have changed since the follow-up was scheduled.
 */
export async function executeFollowUp(
  deps: FollowUpDeps,
  followUp: FollowUp,
  now: Date = new Date(),
): Promise<ExecuteOutcome> {
  if (followUp.status !== 'scheduled') {
    return { status: 'skipped', reason: `already ${followUp.status}`, followUpId: followUp.id };
  }

  const lead = await deps.store.getLead(followUp.business_id, followUp.lead_id);
  if (!lead) {
    await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
      status: 'skipped',
      cancel_reason: 'lead_missing',
    });
    return { status: 'skipped', reason: 'lead_missing', followUpId: followUp.id };
  }

  const context = await loadContext(deps.store, lead, now);
  if (!context) {
    await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
      status: 'skipped',
      cancel_reason: 'context_missing',
    });
    return { status: 'skipped', reason: 'context_missing', followUpId: followUp.id };
  }

  const eligibility = isStillEligibleToSend(context, followUp);
  if (!eligibility.eligible) {
    await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
      status: 'cancelled',
      cancelled_at: now.toISOString(),
      cancel_reason: eligibility.reason,
    });
    await deps.store.updateLead(lead.business_id, lead.id, { next_follow_up_at: null });
    await deps.store.insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'follow_up_cancelled',
      data: { reason: eligibility.reason, follow_up_id: followUp.id },
    });
    return { status: 'cancelled', reason: eligibility.reason, followUpId: followUp.id };
  }

  const provider = await deps.resolveProvider(followUp.business_id);
  const rule = context.rules.find((r) => r.id === followUp.rule_id);
  const business: Business | null = await deps.store.getBusiness(followUp.business_id);

  const result = await sendOutboundMessage({
    store: deps.store,
    provider,
    businessId: followUp.business_id,
    conversation: context.conversation,
    customer: context.customer,
    text: followUp.body ?? '',
    senderType: 'ai',
    aiModel: 'follow-up-rule',
    templatePurpose: rule?.whatsapp_template_purpose ?? null,
    templateParameters: [context.customer.name ?? 'there', business?.name ?? ''],
    now,
  });

  if (result.status === 'failed' || result.status === 'blocked') {
    await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
      status: 'failed',
      attempts: followUp.attempts + 1,
      last_error: result.error ?? 'send failed',
    });
    // The whole product promise is that this message goes out, so a failure is
    // surfaced rather than left on a row nobody opens.
    await logError({
      scope: 'followup.send',
      businessId: followUp.business_id,
      message: `A follow-up could not be sent: ${result.error ?? 'send failed'}`,
      detail: {
        followUpId: followUp.id,
        leadId: followUp.lead_id,
        sequenceIndex: followUp.sequence_index,
        usedTemplate: result.usedTemplate,
      },
    });
    return { status: 'failed', reason: result.error, followUpId: followUp.id };
  }

  await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
    status: 'sent',
    sent_at: now.toISOString(),
    attempts: followUp.attempts + 1,
    message_id: result.message?.id ?? null,
  });

  const updatedLead = await deps.store.updateLead(lead.business_id, lead.id, {
    follow_ups_sent: lead.follow_ups_sent + 1,
    last_response_at: now.toISOString(),
    next_follow_up_at: null,
    status: statusForTemperature(lead.status, lead.temperature, {
      hasBeenAnswered: true,
      followUpDue: false,
    }),
  });

  await deps.store.insertLeadEvent({
    businessId: lead.business_id,
    leadId: lead.id,
    type: 'follow_up_sent',
    data: {
      follow_up_id: followUp.id,
      sequence_index: followUp.sequence_index,
      simulated: result.status === 'simulated',
      used_template: result.usedTemplate,
    },
  });

  await deps.store.insertAnalyticsEvent({
    businessId: lead.business_id,
    type: 'follow_up_sent',
    leadId: lead.id,
    conversationId: lead.conversation_id,
    occurredAt: now.toISOString(),
    data: { sequence_index: followUp.sequence_index },
  });

  // Chain the next step (e.g. the 48h nudge) from this send.
  await scheduleNextFollowUp(deps, updatedLead, now);

  return { status: 'sent', followUpId: followUp.id };
}

/** Worker sweep: sends everything that is due across all tenants. */
export async function runDueFollowUps(
  deps: FollowUpDeps,
  now: Date = new Date(),
  limit = 100,
): Promise<ExecuteOutcome[]> {
  const due = await deps.store.listDueFollowUps(now, limit);
  const outcomes: ExecuteOutcome[] = [];
  for (const followUp of due) {
    try {
      outcomes.push(await executeFollowUp(deps, followUp, now));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.store.updateFollowUp(followUp.business_id, followUp.id, {
        status: 'failed',
        attempts: followUp.attempts + 1,
        last_error: message,
      });
      await logError({
        scope: 'followup.send',
        businessId: followUp.business_id,
        error,
        message: 'A follow-up threw while being sent.',
        detail: { followUpId: followUp.id, leadId: followUp.lead_id },
      });
      outcomes.push({ status: 'failed', reason: message, followUpId: followUp.id });
    }
  }
  return outcomes;
}
