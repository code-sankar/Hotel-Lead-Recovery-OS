'use server';

import { revalidatePath } from 'next/cache';
import { assertCapabilityFor } from '@/lib/auth/session';
import { createServiceSupabase } from '@/lib/db/service-client';
import { getServiceStore } from '@/lib/db/supabase-store';
import { createAiProvider } from '@/lib/ai';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { processInboundMessage } from '@/lib/pipeline/inbound';
import { runDueFollowUps } from '@/lib/followups/service';
import { serverEnv } from '@/lib/env';
import { simulateInboundSchema } from '@/lib/validation/schemas';
import { seedDemoBusiness, simulateInactivity } from './seed';

/**
 * Demo tooling.
 *
 * Every action here drives the real pipeline; only the WhatsApp transport is
 * simulated. Demo actions refuse to run against a hotel that is in live mode,
 * so simulated traffic can never be mixed into a real WhatsApp inbox.
 */

export interface DemoResult {
  ok: boolean;
  error?: string;
  message?: string;
  detail?: string;
}

async function assertDemoAllowed(businessId: string) {
  if (!serverEnv().DEMO_MODE_ENABLED) {
    throw new Error('Demo mode is disabled in this environment.');
  }
  const context = await assertCapabilityFor(businessId, 'demo:run');
  if (context.active.business.messaging_mode !== 'demo') {
    throw new Error(
      'This hotel is in live mode. Switch it back to demo mode before simulating messages.',
    );
  }
  return context;
}

function fail(error: unknown): DemoResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function revalidateAll() {
  revalidatePath('/dashboard');
  revalidatePath('/conversations');
  revalidatePath('/leads');
  revalidatePath('/follow-ups');
  revalidatePath('/analytics');
  revalidatePath('/demo');
}

export async function simulateInboundAction(formData: FormData): Promise<DemoResult> {
  try {
    const parsed = simulateInboundSchema.safeParse({
      businessId: formData.get('businessId'),
      phoneNumber: String(formData.get('phoneNumber') ?? '').replace(/\D/g, ''),
      name: formData.get('name') || undefined,
      text: formData.get('text'),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
    }

    await assertDemoAllowed(parsed.data.businessId);
    const store = getServiceStore();

    const result = await processInboundMessage(
      {
        store,
        ai: createAiProvider(),
        resolveProvider: async (businessId: string) =>
          (await resolveMessagingProvider(store, businessId)).provider,
      },
      {
        businessId: parsed.data.businessId,
        phoneNumber: parsed.data.phoneNumber,
        profileName: parsed.data.name ?? null,
        text: parsed.data.text,
        // Unique per simulated send, so repeated clicks are new messages.
        providerMessageId: `demo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      },
    );

    revalidateAll();

    const summary =
      result.outcome === 'processed'
        ? `Replied: “${(result.replyText ?? '').slice(0, 120)}”`
        : result.outcome === 'escalated'
          ? 'Escalated to your team; the assistant sent your escalation message.'
          : result.outcome === 'human_handling'
            ? 'A staff member is handling this conversation, so the assistant stayed out.'
            : result.note ?? result.outcome;

    return {
      ok: true,
      message: `Processed. Intent: ${result.intent ?? 'unknown'} · score ${result.leadScore ?? 0}.`,
      detail: summary,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function simulateInactivityAction(formData: FormData): Promise<DemoResult> {
  try {
    const businessId = String(formData.get('businessId') ?? '');
    const leadId = String(formData.get('leadId') ?? '');
    await assertDemoAllowed(businessId);

    const client = createServiceSupabase();
    await simulateInactivity(client, businessId, leadId, 25);

    revalidateAll();
    return {
      ok: true,
      message: 'This enquiry now looks 25 hours old, so its follow-up is due.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function runDueFollowUpsAction(formData: FormData): Promise<DemoResult> {
  try {
    const businessId = String(formData.get('businessId') ?? '');
    await assertDemoAllowed(businessId);

    const store = getServiceStore();
    const outcomes = await runDueFollowUps({
      store,
      resolveProvider: async (id: string) => (await resolveMessagingProvider(store, id)).provider,
    });

    revalidateAll();

    const sent = outcomes.filter((outcome) => outcome.status === 'sent').length;
    const cancelled = outcomes.filter((outcome) => outcome.status === 'cancelled').length;
    const failed = outcomes.filter((outcome) => outcome.status === 'failed');

    return {
      ok: true,
      message:
        outcomes.length === 0
          ? 'Nothing was due.'
          : `${sent} sent, ${cancelled} cancelled, ${failed.length} failed.`,
      detail: failed[0]?.reason,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function seedDemoDataAction(formData: FormData): Promise<DemoResult> {
  try {
    const businessId = String(formData.get('businessId') ?? '');
    await assertDemoAllowed(businessId);

    const client = createServiceSupabase();
    const result = await seedDemoBusiness(client, businessId, { useRulesEngine: true });

    revalidateAll();
    return {
      ok: true,
      message: `Seeded ${result.conversations} conversations, ${result.followUpsSent} follow-ups sent, ${result.conversions} conversions.`,
      detail: `Hotel content added: ${result.hotelContent.rooms} rooms, ${result.hotelContent.policies} policies, ${result.hotelContent.faqs} FAQs.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function resetDemoDataAction(formData: FormData): Promise<DemoResult> {
  try {
    const businessId = String(formData.get('businessId') ?? '');
    await assertDemoAllowed(businessId);

    const client = createServiceSupabase();
    // Ordered by dependency; customers cascade to conversations, messages and leads.
    for (const table of ['analytics_events', 'ai_actions', 'staff_notes', 'follow_ups', 'lead_events', 'leads', 'messages', 'conversations', 'customers']) {
      await client.from(table).delete().eq('business_id', businessId);
    }

    revalidateAll();
    return { ok: true, message: 'All conversations, leads and follow-ups for this hotel were deleted.' };
  } catch (error) {
    return fail(error);
  }
}
