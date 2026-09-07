/**
 * Background worker.
 *
 * Run alongside the Next.js app (`npm run worker`). It processes queued jobs
 * and sweeps for due follow-ups, so recovery happens whether or not anyone has
 * the dashboard open.
 */
import 'dotenv/config';
import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAME, type JobName, type JobPayloads } from '@/lib/queue/jobs';
import { runJob } from './processors';

const SWEEP_INTERVAL_MS = 60_000;

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error(
      'REDIS_URL is not set. The worker needs Redis; without it the app runs jobs inline, which is development-only.',
    );
    process.exit(1);
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => runJob(job.name as JobName, job.data as JobPayloads[JobName]),
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] ${job.name} ${job.id} completed`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[worker] ${job?.name} ${job?.id} failed:`, error.message);
  });

  // A repeatable sweep is the source of truth for due follow-ups: even if a
  // delayed job is lost, the next sweep still finds the row in the database.
  await queue.upsertJobScheduler(
    'follow-up-sweep',
    { every: SWEEP_INTERVAL_MS },
    {
      name: 'sweep_follow_ups',
      data: { limit: 100 },
      opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } },
    },
  );

  console.log(`[worker] listening on "${QUEUE_NAME}", sweeping every ${SWEEP_INTERVAL_MS / 1000}s`);

  const shutdown = async () => {
    console.log('[worker] shutting down');
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
