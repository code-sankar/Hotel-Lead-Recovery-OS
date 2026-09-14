'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ConversationMode } from '@/types/domain';
import { assertCapabilityFor } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import { getServiceStore } from '@/lib/db/supabase-store';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { sendOutboundMessage } from '@/lib/pipeline/outbound';
import { cancelFollowUpsForLead, scheduleNextFollowUp } from '@/lib/followups/service';
import { followUpDedupeKey } from '@/lib/followups/engine';
import {
  assignLeadSchema,
  conversationModeSchema,
  convertLeadSchema,
  loseLeadSchema,
  manualFollowUpSchema,
  noteSchema,
  sendMessageSchema,
  updateLeadSchema,
} from '@/lib/validation/schemas';

/**
 * Staff actions on a conversation or lead.
 *
 * Every action resolves the record's own business_id from the database first,
 * then checks that the caller belongs to that hotel — a conversation or lead id
 * from the client is never assumed to be in the caller's tenant.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function firstIssue(error: z.ZodError): ActionResult {
  return { ok: false, error: error.issues[0]?.message ?? 'That input is not valid.' };
}

/** Resolves a conversation and asserts the caller may act on its hotel. */
async function loadConversation(conversationId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) throw new Error('Conversation not found.');
  const conversation = data as { id: string; business_id: string; customer_id: string };
  await assertCapabilityFor(conversation.business_id, 'conversations:handle');
  return conversation;
}

async function loadLead(leadId: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (error || !data) throw new Error('Lead not found.');
  const lead = data as {
    id: string;
    business_id: string;
    conversation_id: string;
    customer_id: string;
    status: string;
    follow_ups_sent: number;
  };
  await assertCapabilityFor(lead.business_id, 'leads:manage');
  return lead;
}

function revalidateConversation(conversationId: string) {
  revalidatePath('/conversations');
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath('/leads');
  revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export async function sendStaffMessageAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = sendMessageSchema.safeParse({
      conversationId: formData.get('conversationId'),
      text: formData.get('text'),
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const context = await loadConversation(parsed.data.conversationId);
    const store = getServiceStore();
    const [conversation, customer] = await Promise.all([
      store.getConversation(context.business_id, context.id),
      store.getCustomer(context.business_id, context.customer_id),
    ]);
    if (!conversation || !customer) return { ok: false, error: 'Conversation not found.' };

    const session = await assertCapabilityFor(context.business_id, 'conversations:handle');
    const { provider } = await resolveMessagingProvider(store, context.business_id);

    const result = await sendOutboundMessage({
      store,
      provider,
      businessId: context.business_id,
      conversation,
      customer,
      text: parsed.data.text,
      senderType: 'staff',
      senderUserId: session.user.id,
      templatePurpose: 'reengagement',
      templateParameters: [customer.name ?? 'there', session.active.business.name],
    });

    if (result.status === 'blocked' || result.status === 'failed') {
      return { ok: false, error: result.error ?? 'The message could not be sent.' };
    }

    const lead = await store.getLeadByConversation(context.business_id, context.id);
    if (lead) {
      await store.insertLeadEvent({
        businessId: context.business_id,
        leadId: lead.id,
        type: 'staff_replied',
        actorType: 'staff',
        actorUserId: session.user.id,
        data: { message_id: result.message?.id },
      });
      await store.updateLead(context.business_id, lead.id, {
        last_response_at: new Date().toISOString(),
      });
    }

    revalidateConversation(context.id);
    return {
      ok: true,
      message: result.status === 'simulated' ? 'Message recorded (demo mode — not sent to WhatsApp).' : undefined,
    };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Human takeover
// ---------------------------------------------------------------------------

export async function setConversationModeAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = conversationModeSchema.safeParse({
      conversationId: formData.get('conversationId'),
      mode: formData.get('mode'),
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const context = await loadConversation(parsed.data.conversationId);
    const session = await assertCapabilityFor(context.business_id, 'conversations:handle');
    const store = getServiceStore();
    const mode: ConversationMode = parsed.data.mode;
    const now = new Date().toISOString();

    await store.updateConversation(context.business_id, context.id, {
      mode,
      taken_over_by: mode === 'ai' ? null : session.user.id,
      taken_over_at: mode === 'ai' ? null : now,
      unread_count: 0,
    });

    const lead = await store.getLeadByConversation(context.business_id, context.id);
    if (lead) {
      const eventType =
        mode === 'human' ? 'human_takeover' : mode === 'paused' ? 'ai_paused' : 'ai_resumed';
      await store.insertLeadEvent({
        businessId: context.business_id,
        leadId: lead.id,
        type: eventType,
        actorType: 'staff',
        actorUserId: session.user.id,
        data: { mode },
      });

      const deps = {
        store,
        resolveProvider: async (businessId: string) =>
          (await resolveMessagingProvider(store, businessId)).provider,
      };

      if (mode === 'ai') {
        // Automation resumes from where it left off.
        await scheduleNextFollowUp(deps, lead);
      } else {
        await cancelFollowUpsForLead(
          deps,
          lead,
          mode === 'human' ? 'human_takeover' : 'conversation_paused',
        );
      }
    }

    revalidateConversation(context.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function markConversationResolvedAction(formData: FormData): Promise<ActionResult> {
  try {
    const conversationId = z.string().uuid().parse(formData.get('conversationId'));
    const context = await loadConversation(conversationId);
    const store = getServiceStore();
    await store.updateConversation(context.business_id, context.id, {
      status: 'resolved',
      unread_count: 0,
    });
    revalidateConversation(context.id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Lead outcomes
// ---------------------------------------------------------------------------

export async function convertLeadAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = convertLeadSchema.safeParse({
      leadId: formData.get('leadId'),
      conversionValue: formData.get('conversionValue'),
      roomId: formData.get('roomId') || null,
      checkIn: formData.get('checkIn') || null,
      checkOut: formData.get('checkOut') || null,
      units: formData.get('units') || null,
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const session = await assertCapabilityFor(lead.business_id, 'leads:manage');
    const store = getServiceStore();
    const now = new Date().toISOString();

    await store.updateLead(lead.business_id, lead.id, {
      status: 'converted',
      converted_at: now,
      conversion_value: parsed.data.conversionValue,
      next_follow_up_at: null,
    });

    await cancelFollowUpsForLead(
      {
        store,
        resolveProvider: async (businessId: string) =>
          (await resolveMessagingProvider(store, businessId)).provider,
      },
      lead,
      'lead_converted',
    );

    // Recording the stay is what consumes inventory, and it is the only way a
    // booking record comes to exist — the assistant never creates one.
    let bookingRecorded = false;
    const { roomId, checkIn, checkOut } = parsed.data;
    if (roomId && checkIn && checkOut && checkOut > checkIn) {
      const supabase = await createServerSupabase();
      const { data: room } = await supabase
        .from('rooms')
        .select('id')
        .eq('business_id', lead.business_id)
        .eq('id', roomId)
        .maybeSingle();

      if (!room) return { ok: false, error: 'That room type does not belong to this hotel.' };

      await store.createBooking({
        businessId: lead.business_id,
        leadId: lead.id,
        customerId: lead.customer_id,
        roomId,
        checkIn,
        checkOut,
        units: parsed.data.units ?? 1,
        totalValue: parsed.data.conversionValue,
        createdBy: session.user.id,
      });
      bookingRecorded = true;
    }

    await store.insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'lead_converted',
      actorType: 'staff',
      actorUserId: session.user.id,
      data: { value: parsed.data.conversionValue, booking_recorded: bookingRecorded },
    });
    await store.insertAnalyticsEvent({
      businessId: lead.business_id,
      type: 'lead_converted',
      leadId: lead.id,
      conversationId: lead.conversation_id,
      value: parsed.data.conversionValue,
      occurredAt: now,
    });

    revalidatePath('/settings/availability');
    revalidateConversation(lead.conversation_id);
    return {
      ok: true,
      message: bookingRecorded
        ? 'Converted, and the stay is now blocked in your availability.'
        : 'Lead marked as converted.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function loseLeadAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = loseLeadSchema.safeParse({
      leadId: formData.get('leadId'),
      reason: formData.get('reason'),
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const session = await assertCapabilityFor(lead.business_id, 'leads:manage');
    const store = getServiceStore();
    const now = new Date().toISOString();

    await store.updateLead(lead.business_id, lead.id, {
      status: 'lost',
      lost_at: now,
      loss_reason: parsed.data.reason || null,
      next_follow_up_at: null,
    });
    await cancelFollowUpsForLead(
      {
        store,
        resolveProvider: async (businessId: string) =>
          (await resolveMessagingProvider(store, businessId)).provider,
      },
      lead,
      'lead_lost',
    );
    await store.insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'lead_lost',
      actorType: 'staff',
      actorUserId: session.user.id,
      data: { reason: parsed.data.reason || null },
    });

    revalidateConversation(lead.conversation_id);
    return { ok: true, message: 'Lead marked as lost.' };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLeadDetailsAction(formData: FormData): Promise<ActionResult> {
  try {
    const raw = {
      leadId: formData.get('leadId'),
      estimatedValue: formData.get('estimatedValue') || null,
      expectedCheckIn: formData.get('expectedCheckIn') || null,
      expectedCheckOut: formData.get('expectedCheckOut') || null,
      guests: formData.get('guests') || null,
      roomPreference: formData.get('roomPreference') || null,
    };
    const parsed = updateLeadSchema.safeParse(raw);
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const store = getServiceStore();
    await store.updateLead(lead.business_id, lead.id, {
      estimated_value: parsed.data.estimatedValue ?? null,
      expected_check_in: parsed.data.expectedCheckIn ?? null,
      expected_check_out: parsed.data.expectedCheckOut ?? null,
      guests: parsed.data.guests ?? null,
      room_preference: parsed.data.roomPreference ?? null,
    });

    revalidateConversation(lead.conversation_id);
    return { ok: true, message: 'Lead updated.' };
  } catch (error) {
    return fail(error);
  }
}

export async function assignLeadAction(formData: FormData): Promise<ActionResult> {
  try {
    const rawStaff = formData.get('staffId');
    const parsed = assignLeadSchema.safeParse({
      leadId: formData.get('leadId'),
      staffId: rawStaff && rawStaff !== '' ? rawStaff : null,
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const session = await assertCapabilityFor(lead.business_id, 'leads:manage');

    // The assignee must be a member of this hotel.
    if (parsed.data.staffId) {
      const supabase = await createServerSupabase();
      const { data: member } = await supabase
        .from('business_members')
        .select('user_id')
        .eq('business_id', lead.business_id)
        .eq('user_id', parsed.data.staffId)
        .maybeSingle();
      if (!member) return { ok: false, error: 'That person is not part of this hotel.' };
    }

    const store = getServiceStore();
    await store.updateLead(lead.business_id, lead.id, { assigned_staff_id: parsed.data.staffId });
    await store.updateConversation(lead.business_id, lead.conversation_id, {
      assigned_staff_id: parsed.data.staffId,
    });
    await store.insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'lead_assigned',
      actorType: 'staff',
      actorUserId: session.user.id,
      data: { assigned_to: parsed.data.staffId },
    });

    revalidateConversation(lead.conversation_id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function addNoteAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = noteSchema.safeParse({
      leadId: formData.get('leadId'),
      body: formData.get('body'),
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const session = await assertCapabilityFor(lead.business_id, 'leads:manage');
    const supabase = await createServerSupabase();

    const { error } = await supabase.from('staff_notes').insert({
      business_id: lead.business_id,
      lead_id: lead.id,
      conversation_id: lead.conversation_id,
      author_id: session.user.id,
      body: parsed.data.body,
    });
    if (error) return { ok: false, error: error.message };

    await getServiceStore().insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'note_added',
      actorType: 'staff',
      actorUserId: session.user.id,
      data: {},
    });

    revalidateConversation(lead.conversation_id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/** Schedules a one-off follow-up chosen by a staff member. */
export async function scheduleManualFollowUpAction(formData: FormData): Promise<ActionResult> {
  try {
    const parsed = manualFollowUpSchema.safeParse({
      leadId: formData.get('leadId'),
      scheduledFor: formData.get('scheduledFor'),
      body: formData.get('body'),
    });
    if (!parsed.success) return firstIssue(parsed.error);

    const lead = await loadLead(parsed.data.leadId);
    const store = getServiceStore();
    const existing = await store.listFollowUpsForLead(lead.business_id, lead.id);
    const sequenceIndex = Math.max(0, ...existing.map((f) => f.sequence_index)) + 1;

    const scheduledFor = new Date(parsed.data.scheduledFor);
    if (scheduledFor.getTime() <= Date.now()) {
      return { ok: false, error: 'Choose a time in the future.' };
    }

    await store.createFollowUp({
      businessId: lead.business_id,
      leadId: lead.id,
      conversationId: lead.conversation_id,
      ruleId: null,
      sequenceIndex,
      scheduledFor: scheduledFor.toISOString(),
      body: parsed.data.body,
      dedupeKey: followUpDedupeKey(lead.id, sequenceIndex, existing.length),
      createdBy: 'staff',
    });
    await store.updateLead(lead.business_id, lead.id, {
      next_follow_up_at: scheduledFor.toISOString(),
    });
    await store.insertLeadEvent({
      businessId: lead.business_id,
      leadId: lead.id,
      type: 'follow_up_scheduled',
      actorType: 'staff',
      data: { scheduled_for: scheduledFor.toISOString(), manual: true },
    });

    revalidateConversation(lead.conversation_id);
    revalidatePath('/follow-ups');
    return { ok: true, message: 'Follow-up scheduled.' };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelFollowUpAction(formData: FormData): Promise<ActionResult> {
  try {
    const followUpId = z.string().uuid().parse(formData.get('followUpId'));
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('follow_ups')
      .select('id, business_id, lead_id, conversation_id, status')
      .eq('id', followUpId)
      .maybeSingle();
    if (!data) return { ok: false, error: 'Follow-up not found.' };

    const followUp = data as { id: string; business_id: string; lead_id: string; conversation_id: string };
    await assertCapabilityFor(followUp.business_id, 'leads:manage');

    const store = getServiceStore();
    await store.updateFollowUp(followUp.business_id, followUp.id, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: 'cancelled_by_staff',
    });
    await store.updateLead(followUp.business_id, followUp.lead_id, { next_follow_up_at: null });
    await store.insertLeadEvent({
      businessId: followUp.business_id,
      leadId: followUp.lead_id,
      type: 'follow_up_cancelled',
      actorType: 'staff',
      data: { reason: 'cancelled_by_staff' },
    });

    revalidatePath('/follow-ups');
    revalidateConversation(followUp.conversation_id);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
