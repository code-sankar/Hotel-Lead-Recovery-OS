import 'server-only';

import type { Queue } from 'bullmq';

import { hasRedis, serverEnv } from '@/lib/env';
import { QUEUE_NAME, jobIdFor, type JobName, type JobPayloads } from './jobs';

/**
 * Background work.
 *
 * With REDIS_URL set, jobs go to BullMQ and are executed by the separate worker
 * process (`npm run worker`), with retries and exponential backoff. Without it,
 * jobs run in-process after the HTTP response is sent — fine for local
 * development, not for production, and the app says so at startup.
 */

let queuePromise: Promise<Queue> | null = null;

async function getQueue() {
  if (!queuePromise) {
    queuePromise = (async () => {
      const { Queue } = await import('bullmq');
      const IORedis = (await import('ioredis')).default;
      const connection = new IORedis(serverEnv().REDIS_URL as string, {
        maxRetriesPerRequest: null,
      });
      return new Queue(QUEUE_NAME, { connection });
    })();
  }
  return queuePromise;
}

export interface EnqueueOptions {
  /** Delay in milliseconds before the job becomes available. */
  delayMs?: number;
}

export async function enqueue<K extends JobName>(
  name: K,
  payload: JobPayloads[K],
  options: EnqueueOptions = {},
): Promise<{ mode: 'queued' | 'inline' }> {
  if (hasRedis()) {
    const queue = await getQueue();
    await queue.add(name, payload, {
      jobId: jobIdFor(name, payload),
      delay: options.delayMs,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86_400 },
    });
    return { mode: 'queued' };
  }

  // Inline fallback. The caller decides when to await this (route handlers use
  // `after()` so the HTTP response is not held open).
  const { runJob } = await import('@/workers/processors');
  await runJob(name, payload);
  return { mode: 'inline' };
}

export { QUEUE_NAME } from './jobs';
export type { JobName, JobPayloads } from './jobs';
