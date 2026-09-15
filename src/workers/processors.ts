import 'server-only';

import { getServiceStore } from '@/lib/db/supabase-store';
import { createAiProvider } from '@/lib/ai';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { processInboundMessage } from '@/lib/pipeline/inbound';
import { executeFollowUp, runDueFollowUps, type FollowUpDeps } from '@/lib/followups/service';
import type { JobName, JobPayloads } from '@/lib/queue/jobs';
import { logError } from '@/lib/monitoring/logger';

/**
 * Job implementations, shared by the BullMQ worker and the inline runner used
 * in development. Each one is safe to run twice: the pipeline dedupes on the
 * provider message id and follow-ups are guarded by their status and dedupe key.
 */

function followUpDeps(): FollowUpDeps {
  const store = getServiceStore();
  return {
    store,
    resolveProvider: async (businessId: string) =>
      (await resolveMessagingProvider(store, businessId)).provider,
  };
}

export async function runJob<K extends JobName>(name: K, payload: JobPayloads[K]): Promise<unknown> {
  try {
    return await dispatch(name, payload);
  } catch (error) {
    // Recorded, then rethrown so the queue still retries with backoff.
    await logError({
      scope: `job.${name}`,
      businessId: businessIdOf(payload),
      error,
      message: `Background job "${name}" failed.`,
    });
    throw error;
  }
}

/** Jobs carry their tenant differently; this keeps the log call honest. */
function businessIdOf(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'businessId' in payload) {
    const value = (payload as { businessId?: unknown }).businessId;
    if (typeof value === 'string') return value;
  }
  return null;
}

async function dispatch<K extends JobName>(name: K, payload: JobPayloads[K]): Promise<unknown> {
  switch (name) {
    case 'process_inbound_message': {
      const input = payload as JobPayloads['process_inbound_message'];
      const store = getServiceStore();
      const result = await processInboundMessage(
        {
          store,
          ai: createAiProvider(),
          resolveProvider: async (businessId: string) =>
            (await resolveMessagingProvider(store, businessId)).provider,
        },
        input,
      );
      if (input.webhookEventId) {
        await store.markWebhookEventProcessed(input.webhookEventId, 'processed');
      }
      return result;
    }

    case 'execute_follow_up': {
      const input = payload as JobPayloads['execute_follow_up'];
      const deps = followUpDeps();
      const followUp = await deps.store.getFollowUp(input.businessId, input.followUpId);
      // The periodic sweep is the reliable path; this job is only a fast lane.
      if (!followUp) return { status: 'skipped', reason: 'not_found', followUpId: input.followUpId };
      return executeFollowUp(deps, followUp);
    }

    case 'sweep_follow_ups': {
      const input = payload as JobPayloads['sweep_follow_ups'];
      return runDueFollowUps(followUpDeps(), new Date(), input.limit ?? 100);
    }

    default: {
      throw new Error(`Unknown job: ${String(name)}`);
    }
  }
}
