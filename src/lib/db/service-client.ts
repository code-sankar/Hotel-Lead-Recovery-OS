import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, requireServiceRoleKey } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Service-role client for webhooks, background workers and demo simulation.
 *
 * It BYPASSES Row Level Security. Any code using it is responsible for scoping
 * every query by business_id; see src/lib/db/supabase-store.ts, which is the
 * only module that should normally reach for it.
 */
export function createServiceSupabase(): SupabaseClient {
  if (cached) return cached;
  const env = publicEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
