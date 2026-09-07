import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Business, MemberRole, Profile } from '@/types/domain';
import { createServerSupabase } from '@/lib/db/server-client';
import { can, type Capability } from './permissions';

export const ACTIVE_BUSINESS_COOKIE = 'hlr_active_business';

export interface Membership {
  business: Business;
  role: MemberRole;
}

export interface Session {
  user: User;
  profile: Profile | null;
  memberships: Membership[];
  active: Membership | null;
}

/**
 * Loads the signed-in user together with every hotel they belong to.
 * `cache` keeps this to one round-trip per request even when several server
 * components ask for it.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberRows }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('business_members').select('role, businesses(*)').eq('user_id', user.id),
  ]);

  const memberships: Membership[] = (memberRows ?? [])
    .map((row) => {
      const record = row as { role: MemberRole; businesses: Business | Business[] | null };
      const business = Array.isArray(record.businesses) ? record.businesses[0] : record.businesses;
      return business ? { business, role: record.role } : null;
    })
    .filter((value): value is Membership => value !== null)
    .sort((a, b) => a.business.name.localeCompare(b.business.name));

  const cookieStore = await cookies();
  const requestedId = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  // Never trust the cookie: the selected hotel must be one the user belongs to.
  const active =
    memberships.find((m) => m.business.id === requestedId) ?? memberships[0] ?? null;

  return { user, profile: (profile as Profile | null) ?? null, memberships, active };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export interface ActiveContext extends Session {
  active: Membership;
}

/** Requires a signed-in user who belongs to at least one hotel. */
export async function requireBusiness(): Promise<ActiveContext> {
  const session = await requireSession();
  if (!session.active) redirect('/onboarding');
  return { ...session, active: session.active };
}

export async function requireCapability(capability: Capability): Promise<ActiveContext> {
  const context = await requireBusiness();
  if (!can(context.active.role, capability)) redirect('/dashboard?denied=1');
  return context;
}

/**
 * Server-action guard: asserts the caller belongs to `businessId` and holds the
 * capability. Never trust a business id that arrived from the client.
 */
export async function assertCapabilityFor(
  businessId: string,
  capability: Capability,
): Promise<ActiveContext> {
  const session = await requireSession();
  const membership = session.memberships.find((m) => m.business.id === businessId);
  if (!membership) throw new Error('You do not have access to this hotel.');
  if (!can(membership.role, capability)) {
    throw new Error('Your role does not allow this action.');
  }
  return { ...session, active: membership };
}
