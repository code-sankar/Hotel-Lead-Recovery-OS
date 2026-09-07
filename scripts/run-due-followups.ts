/**
 * Sends every follow-up that is currently due, once, and exits.
 *
 * Useful without Redis: run it from cron, or by hand while testing.
 * The BullMQ worker (`npm run worker`) does the same thing every minute.
 */
import './env';
import { requireEnv } from './env';
import { getServiceStore } from '@/lib/db/supabase-store';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { runDueFollowUps } from '@/lib/followups/service';

async function main() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const store = getServiceStore();
  const outcomes = await runDueFollowUps({
    store,
    resolveProvider: async (businessId: string) =>
      (await resolveMessagingProvider(store, businessId)).provider,
  });

  if (outcomes.length === 0) {
    console.log('Nothing was due.');
    return;
  }

  const summary = outcomes.reduce<Record<string, number>>((counts, outcome) => {
    counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`Processed ${outcomes.length} follow-up(s):`);
  for (const [status, count] of Object.entries(summary)) {
    console.log(`  ${status}: ${count}`);
  }
  for (const outcome of outcomes.filter((o) => o.status === 'failed')) {
    console.error(`  failed ${outcome.followUpId}: ${outcome.reason}`);
  }
}

main().catch((error) => {
  console.error('Follow-up run failed:', error);
  process.exit(1);
});
