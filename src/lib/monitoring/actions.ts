'use server';

import { revalidatePath } from 'next/cache';
import { assertCapabilityFor } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';

export async function resolveSystemEventAction(
  businessId: string,
  eventId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const context = await assertCapabilityFor(businessId, 'system_health:view');
    const supabase = await createServerSupabase();

    // Resolving is a note that someone looked, not a fix. A recurrence reopens
    // the row automatically — see record_system_event.
    const { error } = await supabase
      .from('system_events')
      .update({ resolved_at: new Date().toISOString(), resolved_by: context.user.id })
      .eq('business_id', businessId)
      .eq('id', eventId);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/settings/health');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
