import type { Lead, LeadIntent, MessageType } from '@/types/domain';
import type { Store } from '@/lib/db/store';
import type { MessagingProvider } from '@/lib/messaging/types';
import type { AiProvider, AiToolCall, ConversationTurn } from '@/lib/ai/types';
import { isOptOut, isQualifyingIntent } from '@/lib/ai/intent';
import { mergeEntities, type BookingEntities } from '@/lib/ai/entities';
import { enforceGuardrails, type AvailabilityContext } from '@/lib/ai/guardrails';
import { checkAvailability, roomsFromKnowledge } from '@/lib/availability/service';
import { deriveLeadScore, detectSignals } from '@/lib/leads/scoring';
import { statusForTemperature } from '@/lib/leads/status';
import { cancelFollowUpsForLead, scheduleNextFollowUp, type FollowUpDeps } from '@/lib/followups/service';
import { sendOutboundMessage, previewOf } from './outbound';
import { logError, logWarning } from '@/lib/monitoring/logger';

/**
 * Inbound message pipeline.
 *
 * webhook/simulator → dedupe → customer → conversation → persist message →
 * lead → analysis → entities → deterministic score → reply decision →
 * guardrails → send → telemetry → follow-up scheduling.
 *
 * Everything here is idempotent on `providerMessageId`: a redelivered webhook
 * short-circuits before anything is written.
 */

export interface InboundPipelineDeps {
  store: Store;
  ai: AiProvider;
  resolveProvider: (businessId: string) => Promise<MessagingProvider>;
}

export interface ProcessInboundInput {
  businessId: string;
  phoneNumber: string;
  profileName?: string | null;
  text: string | null;
  messageType?: MessageType;
  providerMessageId?: string | null;
  rawPayload?: unknown;
  now?: Date;
}

export type InboundOutcome =
  | 'processed'
  | 'duplicate'
  | 'no_text'
  | 'ai_disabled'
  | 'human_handling'
  | 'escalated'
  | 'send_blocked'
  | 'send_failed';

export interface ProcessInboundResult {
  outcome: InboundOutcome;
  conversationId?: string;
  leadId?: string;
  inboundMessageId?: string;
  outboundMessageId?: string;
  replyText?: string | null;
  intent?: LeadIntent;
  leadScore?: number;
  guardrailFlags?: string[];
  followUpScheduledFor?: string | null;
  simulated?: boolean;
  note?: string;
}

export async function processInboundMessage(
  deps: InboundPipelineDeps,
  input: ProcessInboundInput,
): Promise<ProcessInboundResult> {
  const { store } = deps;
  const now = input.now ?? new Date();
  const businessId = input.businessId;

  // 1. Idempotency — a redelivered webhook must not duplicate anything.
  if (input.providerMessageId) {
    const existing = await store.findMessageByProviderId(businessId, input.providerMessageId);
    if (existing) {
      return {
        outcome: 'duplicate',
        conversationId: existing.conversation_id,
        inboundMessageId: existing.id,
      };
    }
  }

  // 2–3. Customer and conversation.
  const customer = await store.findOrCreateCustomer({
    businessId,
    phoneNumber: input.phoneNumber,
    name: input.profileName ?? null,
  });
  const conversation = await store.findOrCreateConversation(businessId, customer.id);

  // 4. Persist the inbound message before any slow work happens.
  const inboundMessage = await store.insertMessage({
    businessId,
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'customer',
    messageType: input.messageType ?? 'text',
    text: input.text,
    providerMessageId: input.providerMessageId ?? null,
    rawPayload: input.rawPayload ?? null,
  });

  await store.updateConversation(businessId, conversation.id, {
    last_inbound_at: now.toISOString(),
    last_message_at: now.toISOString(),
    last_message_preview: previewOf(input.text),
    unread_count: conversation.unread_count + 1,
  });
  conversation.last_inbound_at = now.toISOString();

  await store.insertAnalyticsEvent({
    businessId,
    type: 'message_received',
    conversationId: conversation.id,
    occurredAt: now.toISOString(),
  });

  // 5. Lead — one open lead per conversation.
  let lead = await store.getLeadByConversation(businessId, conversation.id);
  const isNewLead = !lead;
  if (!lead) {
    lead = await store.createLead({
      businessId,
      customerId: customer.id,
      conversationId: conversation.id,
      status: 'new',
      lastCustomerMessageAt: now.toISOString(),
    });
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'lead_created',
      data: { source: 'whatsapp' },
    });
    await store.insertAnalyticsEvent({
      businessId,
      type: 'lead_created',
      leadId: lead.id,
      conversationId: conversation.id,
      occurredAt: now.toISOString(),
    });
  } else {
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'customer_replied',
      data: { message_id: inboundMessage.id },
    });
  }

  const followUpDeps: FollowUpDeps = {
    store: deps.store,
    resolveProvider: deps.resolveProvider,
  };

  // 6. A reply always cancels pending automation — never chase someone who answered.
  if (!isNewLead) {
    await cancelFollowUpsForLead(followUpDeps, lead, 'customer_replied');
  }

  if (!input.text || !input.text.trim()) {
    // Non-text media still counts as activity, but there is nothing to analyse.
    await store.updateLead(businessId, lead.id, { last_customer_message_at: now.toISOString() });
    return {
      outcome: 'no_text',
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      note: 'Message carried no text the assistant can read.',
    };
  }

  // 7. Opt-out is honoured before anything else commercial happens.
  const optedOut = isOptOut(input.text);
  if (optedOut && !customer.opted_out) {
    await store.updateCustomer(businessId, customer.id, {
      opted_out: true,
      opted_out_at: now.toISOString(),
    });
    customer.opted_out = true;
    await cancelFollowUpsForLead(followUpDeps, lead, 'customer_opted_out');
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'customer_opted_out',
      data: {},
    });
  }

  const settings = await store.getSettings(businessId);
  const knowledge = await store.loadKnowledge(businessId);
  if (!settings || !knowledge) {
    return {
      outcome: 'ai_disabled',
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      note: 'Hotel profile or settings are not configured yet.',
    };
  }

  const history = await buildHistory(store, businessId, conversation.id, inboundMessage.id);

  // 8. Structured analysis of the message.
  const analysis = await deps.ai.analyze({
    message: input.text,
    history,
    knowledge,
    customerName: customer.name,
    now,
  });

  // 9. Entities and deterministic score. The model never sets the score.
  const mergedEntities = mergeEntities(
    {
      checkIn: lead.expected_check_in ?? undefined,
      checkOut: lead.expected_check_out ?? undefined,
      guests: lead.guests ?? undefined,
      roomPreference: lead.room_preference ?? undefined,
    },
    analysis.entities,
  );

  const customerMessages = [...history.filter((t) => t.role === 'customer').map((t) => t.text), input.text];
  const scoring = deriveLeadScore({
    customerMessages,
    entities: {
      checkIn: mergedEntities.checkIn ?? null,
      checkOut: mergedEntities.checkOut ?? null,
      guests: mergedEntities.guests ?? null,
    },
    minutesSinceLastCustomerMessage: 0,
  });

  lead = await applyLeadUpdate(store, lead, {
    intent: analysis.intent,
    entities: mergedEntities,
    score: scoring.score,
    temperature: scoring.temperature,
    knowledgeNightlyRates: knowledge.rooms.map((room) => room.basePrice),
    lastCustomerMessageAt: now.toISOString(),
  });

  await store.insertLeadEvent({
    businessId,
    leadId: lead.id,
    type: 'lead_scored',
    data: {
      score: scoring.score,
      temperature: scoring.temperature,
      signals: scoring.signals,
      intent: analysis.intent,
    },
  });
  await store.insertLeadEvent({
    businessId,
    leadId: lead.id,
    type: 'intent_detected',
    data: { intent: analysis.intent, confidence: analysis.confidence },
  });

  // 10. Should the assistant reply at all?
  const gate = replyGate({
    aiEnabled: settings.ai_enabled,
    conversationMode: conversation.mode,
  });

  if (!gate.canReply) {
    await store.insertAiAction({
      businessId,
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      provider: deps.ai.name,
      model: deps.ai.model,
      intent: analysis.intent,
      confidence: analysis.confidence,
      requiresHuman: analysis.requiresHuman,
      requiresFollowUp: analysis.requiresFollowUp,
      suggestedAction: analysis.suggestedAction,
      entities: mergedEntities as Record<string, unknown>,
      decision: gate.reason,
    });
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'ai_skipped',
      data: { reason: gate.reason },
    });
    return {
      outcome: gate.outcome,
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      intent: analysis.intent,
      leadScore: scoring.score,
      note: gate.note,
    };
  }

  const provider = await deps.resolveProvider(businessId);

  // 11. Escalation short-circuits generation: the hotel's own escalation
  // message is sent verbatim and the conversation moves to human handling.
  if (analysis.requiresHuman) {
    const escalation = await sendOutboundMessage({
      store,
      provider,
      businessId,
      conversation,
      customer,
      text: settings.ai_escalation_message,
      senderType: 'ai',
      aiModel: deps.ai.model,
      templatePurpose: 'reengagement',
      now,
    });

    await store.updateConversation(businessId, conversation.id, {
      mode: 'human',
      taken_over_at: now.toISOString(),
    });
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'human_takeover',
      actorType: 'ai',
      data: { reason: `escalated: ${analysis.intent}` },
    });
    await store.insertAiAction({
      businessId,
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      outboundMessageId: escalation.message?.id ?? null,
      provider: deps.ai.name,
      model: deps.ai.model,
      intent: analysis.intent,
      confidence: analysis.confidence,
      requiresHuman: true,
      requiresFollowUp: false,
      suggestedAction: 'escalate_to_human',
      entities: mergedEntities as Record<string, unknown>,
      decision: 'escalated_to_human',
    });

    return {
      outcome: 'escalated',
      conversationId: conversation.id,
      leadId: lead.id,
      inboundMessageId: inboundMessage.id,
      outboundMessageId: escalation.message?.id,
      replyText: settings.ai_escalation_message,
      intent: analysis.intent,
      leadScore: scoring.score,
      simulated: escalation.status === 'simulated',
    };
  }

  // 12. Verify availability for the dates this enquiry is about. This is the
  // only thing that licenses the assistant to state a room is free, so it is
  // computed by the application and handed to both the writer and the checker.
  const availability = await checkAvailability(
    store,
    businessId,
    roomsFromKnowledge(knowledge),
    {
      checkIn: lead.expected_check_in,
      checkOut: lead.expected_check_out,
      guests: lead.guests,
    },
  );

  const availabilityContext: AvailabilityContext | null =
    availability && availability.nights > 0
      ? {
          checkIn: availability.checkIn,
          checkOut: availability.checkOut,
          anyAvailable: availability.anyAvailable,
          availableRoomNames: availability.rooms.filter((r) => r.available).map((r) => r.roomName),
          soldOutRoomNames: availability.rooms.filter((r) => !r.available).map((r) => r.roomName),
        }
      : null;

  // 13. Generate, then verify against trusted data before sending.
  const generation = await deps.ai.reply({
    message: input.text,
    history,
    knowledge,
    analysis,
    leadState: {
      status: lead.status,
      score: lead.lead_score,
      temperature: lead.temperature,
      checkIn: lead.expected_check_in,
      checkOut: lead.expected_check_out,
      guests: lead.guests,
      roomPreference: lead.room_preference,
      followUpsSent: lead.follow_ups_sent,
    },
    customerName: customer.name,
    availability,
  });

  const guarded = enforceGuardrails({
    reply: generation.text ?? '',
    knowledge,
    conversationContext: history.map((turn) => turn.text),
    availability: availabilityContext,
  });

  const sendResult = await sendOutboundMessage({
    store,
    provider,
    businessId,
    conversation,
    customer,
    text: guarded.text,
    senderType: 'ai',
    aiModel: generation.model,
    templatePurpose: 'reengagement',
    now,
  });

  await store.insertAiAction({
    businessId,
    conversationId: conversation.id,
    leadId: lead.id,
    inboundMessageId: inboundMessage.id,
    outboundMessageId: sendResult.message?.id ?? null,
    provider: generation.provider,
    model: generation.model,
    intent: analysis.intent,
    confidence: analysis.confidence,
    requiresHuman: analysis.requiresHuman,
    requiresFollowUp: analysis.requiresFollowUp,
    suggestedAction: analysis.suggestedAction,
    entities: {
      ...(mergedEntities as Record<string, unknown>),
      availability_checked: Boolean(availabilityContext),
      ...(availabilityContext
        ? {
            availability_window: `${availabilityContext.checkIn}/${availabilityContext.checkOut}`,
            available_rooms: availabilityContext.availableRoomNames,
          }
        : {}),
    },
    decision: guarded.blocked ? 'blocked_by_guardrails' : sendResult.status,
    guardrailFlags: guarded.flags,
    latencyMs: generation.latencyMs,
    error: generation.error ?? sendResult.error ?? null,
  });

  if (guarded.blocked) {
    // The model tried to state something the hotel data cannot support. This is
    // the guardrail working, but a hotel seeing it often should know: it means
    // the assistant is unreliable for them and their team is picking up the slack.
    await logWarning({
      scope: 'ai.guardrail',
      businessId,
      message: `A generated reply was blocked before sending: ${guarded.flags.join(', ')}`,
      detail: {
        conversationId: conversation.id,
        flags: guarded.flags,
        model: generation.model,
        availabilityChecked: Boolean(availabilityContext),
      },
    });

    await store.updateConversation(businessId, conversation.id, {
      mode: 'human',
      taken_over_at: now.toISOString(),
    });
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'human_takeover',
      actorType: 'system',
      data: { reason: 'guardrail_block', flags: guarded.flags },
    });
  } else if (sendResult.message) {
    await store.insertLeadEvent({
      businessId,
      leadId: lead.id,
      type: 'ai_replied',
      data: { message_id: sendResult.message.id, simulated: sendResult.status === 'simulated' },
    });
    await store.insertAnalyticsEvent({
      businessId,
      type: 'message_sent',
      leadId: lead.id,
      conversationId: conversation.id,
      occurredAt: now.toISOString(),
      data: { sender: 'ai' },
    });
  }

  if (sendResult.status === 'failed' || sendResult.status === 'blocked') {
    // A guest asked something and got nothing back.
    await logError({
      scope: 'messaging.outbound',
      businessId,
      message: `A reply could not be delivered: ${sendResult.error ?? sendResult.status}`,
      detail: {
        conversationId: conversation.id,
        status: sendResult.status,
        usedTemplate: sendResult.usedTemplate,
        windowKind: sendResult.window.kind,
      },
    });
  }

  if (sendResult.status === 'sent' || sendResult.status === 'simulated') {
    lead = await store.updateLead(businessId, lead.id, {
      last_response_at: now.toISOString(),
      status: statusForTemperature(lead.status, lead.temperature, {
        hasBeenAnswered: true,
        followUpDue: false,
      }),
    });
  }

  // 14. Model-requested actions, applied by the application, not the model.
  await applyToolCalls(deps, followUpDeps, lead, generation.toolCalls, now);

  // 15. Follow-up scheduling.
  let followUpScheduledFor: string | null = null;
  // A follow-up is owed while the enquiry itself is live — judged from the
  // lead's standing intent, not just the last message, since "2" or "let me
  // check" classify as `unknown` while the enquiry is still very much open.
  const declined = detectSignals(input.text).includes('not_interested');
  const shouldScheduleFollowUp =
    !customer.opted_out &&
    !declined &&
    !guarded.blocked &&
    (analysis.requiresFollowUp || isQualifyingIntent(analysis.intent) || isQualifyingIntent(lead.intent));

  if (declined) {
    await cancelFollowUpsForLead(followUpDeps, lead, 'cancelled_by_ai');
  }

  if (shouldScheduleFollowUp) {
    const refreshed = (await store.getLead(businessId, lead.id)) ?? lead;
    const outcome = await scheduleNextFollowUp(followUpDeps, refreshed, now);
    if (outcome.decision.action === 'schedule') {
      followUpScheduledFor = outcome.decision.scheduledFor.toISOString();
    }
  }

  return {
    outcome: sendResult.status === 'blocked' ? 'send_blocked' : sendResult.status === 'failed' ? 'send_failed' : 'processed',
    conversationId: conversation.id,
    leadId: lead.id,
    inboundMessageId: inboundMessage.id,
    outboundMessageId: sendResult.message?.id,
    replyText: guarded.text,
    intent: analysis.intent,
    leadScore: scoring.score,
    guardrailFlags: guarded.flags,
    followUpScheduledFor,
    simulated: sendResult.status === 'simulated',
    note: sendResult.error,
  };
}

interface ReplyGateInput {
  aiEnabled: boolean;
  conversationMode: 'ai' | 'human' | 'paused';
}

/**
 * Human takeover is absolute: while a conversation is in human or paused mode
 * the assistant never sends an unsolicited reply.
 */
export function replyGate(input: ReplyGateInput): {
  canReply: boolean;
  reason: string;
  outcome: InboundOutcome;
  note?: string;
} {
  if (input.conversationMode === 'human') {
    return {
      canReply: false,
      reason: 'human_handling',
      outcome: 'human_handling',
      note: 'A staff member has taken over this conversation.',
    };
  }
  if (input.conversationMode === 'paused') {
    return {
      canReply: false,
      reason: 'ai_paused',
      outcome: 'human_handling',
      note: 'The assistant is paused for this conversation.',
    };
  }
  if (!input.aiEnabled) {
    return {
      canReply: false,
      reason: 'ai_disabled',
      outcome: 'ai_disabled',
      note: 'The assistant is switched off for this hotel.',
    };
  }
  return { canReply: true, reason: 'ai_reply', outcome: 'processed' };
}

async function buildHistory(
  store: Store,
  businessId: string,
  conversationId: string,
  excludeMessageId: string,
): Promise<ConversationTurn[]> {
  const messages = await store.listMessages(businessId, conversationId, 30);
  return messages
    .filter((message) => message.id !== excludeMessageId && message.text)
    .map((message) => ({
      role:
        message.sender_type === 'customer'
          ? ('customer' as const)
          : message.sender_type === 'staff'
            ? ('staff' as const)
            : message.sender_type === 'ai'
              ? ('ai' as const)
              : ('system' as const),
      text: message.text ?? '',
      at: message.created_at,
    }));
}

interface LeadUpdateInput {
  intent: LeadIntent;
  entities: BookingEntities;
  score: number;
  temperature: Lead['temperature'];
  knowledgeNightlyRates: number[];
  lastCustomerMessageAt: string;
}

async function applyLeadUpdate(
  store: Store,
  lead: Lead,
  input: LeadUpdateInput,
): Promise<Lead> {
  const nights = estimateNights(input.entities);
  const cheapestRate = [...input.knowledgeNightlyRates].sort((a, b) => a - b)[0];
  // Estimated value is arithmetic on configured room rates, never invented.
  const estimatedValue =
    cheapestRate !== undefined && nights > 0 ? Number((cheapestRate * nights).toFixed(2)) : lead.estimated_value;

  return store.updateLead(lead.business_id, lead.id, {
    // A short reply like "2" classifies as `unknown`; that must not erase the
    // commercial intent the enquiry already established.
    intent: input.intent === 'unknown' ? lead.intent : input.intent,
    lead_score: input.score,
    temperature: input.temperature,
    expected_check_in: input.entities.checkIn ?? lead.expected_check_in,
    expected_check_out: input.entities.checkOut ?? lead.expected_check_out,
    guests: input.entities.guests ?? lead.guests,
    room_preference: input.entities.roomPreference ?? lead.room_preference,
    estimated_value: estimatedValue,
    last_customer_message_at: input.lastCustomerMessageAt,
    status: statusForTemperature(lead.status, input.temperature, {
      hasBeenAnswered: Boolean(lead.last_response_at),
      followUpDue: false,
    }),
  });
}

function estimateNights(entities: BookingEntities): number {
  if (entities.nights && entities.nights > 0) return entities.nights;
  if (entities.checkIn && entities.checkOut) {
    const start = new Date(`${entities.checkIn}T00:00:00Z`).getTime();
    const end = new Date(`${entities.checkOut}T00:00:00Z`).getTime();
    const nights = Math.round((end - start) / 86_400_000);
    if (nights > 0 && nights <= 60) return nights;
  }
  return entities.checkIn ? 1 : 0;
}

/**
 * Tool calls are REQUESTS. The application validates and applies them; the
 * model has no direct database access.
 */
async function applyToolCalls(
  deps: InboundPipelineDeps,
  followUpDeps: FollowUpDeps,
  lead: Lead,
  toolCalls: AiToolCall[],
  now: Date,
): Promise<void> {
  for (const call of toolCalls) {
    switch (call.name) {
      case 'flag_for_human': {
        await deps.store.updateConversation(lead.business_id, lead.conversation_id, {
          mode: 'human',
          taken_over_at: now.toISOString(),
        });
        await deps.store.insertLeadEvent({
          businessId: lead.business_id,
          leadId: lead.id,
          type: 'human_takeover',
          actorType: 'ai',
          data: { reason: call.arguments.reason },
        });
        await cancelFollowUpsForLead(followUpDeps, lead, 'human_takeover');
        break;
      }
      case 'cancel_follow_up': {
        await cancelFollowUpsForLead(followUpDeps, lead, 'cancelled_by_ai');
        break;
      }
      case 'update_lead': {
        const patch: Partial<Lead> = {};
        if (call.arguments.check_in) patch.expected_check_in = call.arguments.check_in;
        if (call.arguments.check_out) patch.expected_check_out = call.arguments.check_out;
        if (call.arguments.guests) patch.guests = call.arguments.guests;
        if (call.arguments.room_preference) patch.room_preference = call.arguments.room_preference;
        if (Object.keys(patch).length > 0) {
          await deps.store.updateLead(lead.business_id, lead.id, patch);
        }
        break;
      }
      case 'schedule_follow_up': {
        // Scheduling is owned by the rules engine; the request is only a hint
        // and is honoured on the normal path below.
        break;
      }
    }
  }
}
