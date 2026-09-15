'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createServerSupabase } from '@/lib/db/server-client';
import { ACTIVE_BUSINESS_COOKIE, assertCapabilityFor, requireSession } from '@/lib/auth/session';
import { publicEnv } from '@/lib/env';
import { inviteStaffSchema } from '@/lib/validation/schemas';
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  inviteUrl,
  isWellFormedInviteToken,
} from './tokens';

/**
 * Invitations.
 *
 * Creating one returns the link exactly once — it is the only moment the
 * plaintext token exists outside the recipient's hands. The owner shares it
 * however they like, which for this product is usually WhatsApp.
 */

export interface InviteResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Present only on the response that created it; never re-readable. */
  url?: string;
}

export async function createInviteAction(
  businessId: string,
  formData: FormData,
): Promise<InviteResult> {
  try {
    const context = await assertCapabilityFor(businessId, 'staff:manage');

    const parsed = inviteStaffSchema.safeParse({
      email: formData.get('email'),
      role: formData.get('role'),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
    }

    const supabase = await createServerSupabase();

    // Already on the team: an invite would be a no-op that looks like progress.
    const { data: existingMember } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', parsed.data.email)
      .maybeSingle();

    if (existingMember) {
      const { data: membership } = await supabase
        .from('business_members')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', (existingMember as { id: string }).id)
        .maybeSingle();
      if (membership) {
        return { ok: false, error: `${parsed.data.email} is already on this hotel's team.` };
      }
    }

    // Re-inviting supersedes any outstanding invite for that address, which is
    // also what keeps the partial unique index satisfied.
    await supabase
      .from('business_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .ilike('email', parsed.data.email);

    const token = generateInviteToken();
    const { error } = await supabase.from('business_invites').insert({
      business_id: businessId,
      email: parsed.data.email,
      role: parsed.data.role,
      token_hash: hashInviteToken(token),
      invited_by: context.user.id,
      expires_at: inviteExpiryFrom().toISOString(),
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath('/settings/team');
    return {
      ok: true,
      url: inviteUrl(publicEnv().NEXT_PUBLIC_APP_URL, token),
      message: `Invite ready for ${parsed.data.email}. Copy the link and send it to them — it works once and expires in 7 days.`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function revokeInviteAction(
  businessId: string,
  inviteId: string,
): Promise<InviteResult> {
  try {
    await assertCapabilityFor(businessId, 'staff:manage');
    const supabase = await createServerSupabase();

    const { error } = await supabase
      .from('business_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', inviteId)
      .is('accepted_at', null);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/settings/team');
    return { ok: true, message: 'Invitation revoked. The link no longer works.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface InvitePreview {
  businessName: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

/** What an invite link points at, readable before the recipient is a member. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  if (!isWellFormedInviteToken(token)) return null;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('preview_business_invite', {
    invite_token_hash: hashInviteToken(token),
  });
  if (error || !data) return null;

  const row = (Array.isArray(data) ? data[0] : data) as
    | { business_name: string; email: string; role: string; status: InvitePreview['status'] }
    | undefined;
  if (!row) return null;

  return {
    businessName: row.business_name,
    email: row.email,
    role: row.role,
    status: row.status,
  };
}

export async function acceptInviteAction(token: string): Promise<InviteResult> {
  try {
    if (!isWellFormedInviteToken(token)) {
      return { ok: false, error: 'This invitation link is not valid.' };
    }
    await requireSession();

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('accept_business_invite', {
      invite_token_hash: hashInviteToken(token),
    });

    if (error) {
      // The RPC raises messages written for the recipient, so pass them through.
      return { ok: false, error: error.message };
    }

    // Land them in the hotel they just joined.
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_BUSINESS_COOKIE, String(data), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });

    revalidatePath('/', 'layout');
    return { ok: true, message: 'You have joined the team.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
