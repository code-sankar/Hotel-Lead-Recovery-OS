'use server';

import { revalidatePath } from 'next/cache';
import { assertCapabilityFor } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { FormState } from '@/lib/forms/state';
import { availabilityUpdateSchema } from '@/lib/validation/schemas';
import { nightsBetween } from './calculate';

/**
 * Availability editing.
 *
 * The hotel only ever records EXCEPTIONS: a date is closed, or has fewer (or
 * more) rooms than the type's default. "Clear" removes the exception and the
 * date goes back to the default, which is why a hotel never has to fill in a
 * calendar to get correct answers.
 */

/** One bulk edit cannot be allowed to write an unbounded number of rows. */
const MAX_DAYS_PER_UPDATE = 180;

export async function updateAvailabilityAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertCapabilityFor(businessId, 'availability:manage');

  const rawRoom = formData.get('roomId');
  const parsed = availabilityUpdateSchema.safeParse({
    roomId: rawRoom && rawRoom !== 'all' ? rawRoom : null,
    from: formData.get('from'),
    to: formData.get('to'),
    action: formData.get('action'),
    units: formData.get('units') || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const { roomId, from, to, action, units } = parsed.data;
  const supabase = await createServerSupabase();

  // The picker is inclusive of the end date, which is what "close the 15th to
  // the 17th" means to a hotelier; nightsBetween is exclusive, so extend by one.
  const endExclusive = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dates = nightsBetween(from, endExclusive);

  if (dates.length === 0) return { ok: false, error: 'That date range is not valid.' };
  if (dates.length > MAX_DAYS_PER_UPDATE) {
    return { ok: false, error: `Change at most ${MAX_DAYS_PER_UPDATE} days at a time.` };
  }

  const { data: roomRows, error: roomsError } = await supabase
    .from('rooms')
    .select('id')
    .eq('business_id', businessId)
    .eq('active', true);
  if (roomsError) return { ok: false, error: roomsError.message };

  const allRoomIds = (roomRows ?? []).map((row) => row.id as string);
  // A room id from the form is only honoured if it belongs to this hotel.
  const roomIds = roomId ? allRoomIds.filter((id) => id === roomId) : allRoomIds;
  if (roomIds.length === 0) {
    return { ok: false, error: 'No active room types to update.' };
  }

  if (action === 'clear') {
    const { error } = await supabase
      .from('room_availability')
      .delete()
      .eq('business_id', businessId)
      .in('room_id', roomIds)
      .gte('date', from)
      .lte('date', to);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      message: `Cleared overrides on ${dates.length} date${dates.length === 1 ? '' : 's'}; they now use each room type's default.`,
    };
  }

  const rows = roomIds.flatMap((room) =>
    dates.map((date) => ({
      business_id: businessId,
      room_id: room,
      date,
      closed: action === 'close',
      units_available: action === 'set_units' ? (units as number) : null,
    })),
  );

  const { error } = await supabase
    .from('room_availability')
    .upsert(rows, { onConflict: 'business_id,room_id,date' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings/availability');
  revalidatePath('/conversations');

  const summary =
    action === 'close'
      ? 'closed'
      : action === 'open'
        ? 'reopened at the default room count'
        : `set to ${units} room${units === 1 ? '' : 's'}`;

  return {
    ok: true,
    message: `${dates.length} date${dates.length === 1 ? '' : 's'} ${summary} for ${roomIds.length} room type${roomIds.length === 1 ? '' : 's'}.`,
  };
}
