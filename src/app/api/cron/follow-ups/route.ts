import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { getServiceStore } from '@/lib/db/supabase-store';
import { resolveMessagingProvider } from '@/lib/messaging/resolve';
import { runDueFollowUps } from '@/lib/followups/service';
import { timingSafeEqualString } from '@/lib/security/compare';

/**
 * Scheduled sweep for due follow-ups.
 *
 * The BullMQ worker does this every minute when Redis is available. This
 * endpoint exists so a deployment without a long-running worker (Vercel Cron,
 * for example) can still drive recovery on a schedule.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured, so this endpoint is disabled.' },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';
  if (!timingSafeEqualString(provided, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const store = getServiceStore();
  const outcomes = await runDueFollowUps({
    store,
    resolveProvider: async (businessId: string) =>
      (await resolveMessagingProvider(store, businessId)).provider,
  });

  const summary = outcomes.reduce<Record<string, number>>((counts, outcome) => {
    counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    return counts;
  }, {});

  return NextResponse.json({ processed: outcomes.length, summary });
}
