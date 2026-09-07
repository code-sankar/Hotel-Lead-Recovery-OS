'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerSupabase } from '@/lib/db/server-client';
import { publicEnv } from '@/lib/env';
import {
  profileSchema,
  resetRequestSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from '@/lib/validation/schemas';
import { fieldErrorsOf, type FormState } from '@/lib/forms/state';
import { ACTIVE_BUSINESS_COOKIE, requireSession } from './session';

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) return { ok: false, error: error.message };
  redirect('/onboarding');
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Deliberately generic: never reveal whether an address is registered.
  if (error) return { ok: false, error: 'That email and password do not match an account.' };

  const next = String(formData.get('next') ?? '/dashboard');
  redirect(next.startsWith('/') ? next : '/dashboard');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_BUSINESS_COOKIE);
  redirect('/login');
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createServerSupabase();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/update-password`,
  });

  // Always the same response, whether or not the address exists.
  return {
    ok: true,
    message: 'If that email has an account, a reset link is on its way.',
  };
}

export async function updatePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updatePasswordSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  redirect('/dashboard');
}

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const parsed = profileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
    .eq('id', session.user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/profile');
  return { ok: true, message: 'Profile updated.' };
}

export async function switchBusinessAction(businessId: string): Promise<void> {
  const session = await requireSession();
  // Only a hotel the user actually belongs to may become active.
  if (!session.memberships.some((m) => m.business.id === businessId)) {
    throw new Error('You do not have access to this hotel.');
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}
