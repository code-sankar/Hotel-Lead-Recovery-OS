import type { ProcessInboundInput } from '@/lib/pipeline/inbound';

/** Job contracts shared by the queue, the inline runner and the worker. */
export const JOB_NAMES = ['process_inbound_message', 'execute_follow_up', 'sweep_follow_ups'] as const;

export type JobName = (typeof JOB_NAMES)[number];

export interface JobPayloads {
  process_inbound_message: ProcessInboundInput & { webhookEventId?: string };
  execute_follow_up: { businessId: string; followUpId: string };
  sweep_follow_ups: { limit?: number };
}

export const QUEUE_NAME = 'lead-stay';

/**
 * A stable job id makes enqueueing idempotent: a retried webhook produces the
 * same id, and BullMQ drops the duplicate instead of running the pipeline twice.
 */
export function jobIdFor<K extends JobName>(name: K, payload: JobPayloads[K]): string | undefined {
  switch (name) {
    case 'process_inbound_message': {
      const input = payload as JobPayloads['process_inbound_message'];
      return input.providerMessageId ? `inbound:${input.businessId}:${input.providerMessageId}` : undefined;
    }
    case 'execute_follow_up': {
      const input = payload as JobPayloads['execute_follow_up'];
      return `followup:${input.followUpId}`;
    }
    default:
      return undefined;
  }
}
