import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { listTeamMembers } from '@/lib/db/queries';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessInvite } from '@/types/domain';
import { InviteManager } from '@/components/settings/invite-manager';
import { SettingsSection } from '@/components/settings/settings-section';
import { TeamTable } from '@/components/settings/team-table';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamSettingsPage() {
  const { active, user } = await requireCapability('staff:manage');
  const supabase = await createServerSupabase();

  const [members, { data: inviteRows }] = await Promise.all([
    listTeamMembers(active.business.id),
    supabase
      .from('business_invites')
      .select('*')
      .eq('business_id', active.business.id)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  const invites = (inviteRows ?? []) as BusinessInvite[];

  return (
    <>
      <SettingsSection title="Team" description="Who can see and act on this hotel’s enquiries.">
        <TeamTable businessId={active.business.id} currentUserId={user.id} members={members} />
      </SettingsSection>

      <SettingsSection
        title="Invite a colleague"
        description="Create a link and send it to them however you like — WhatsApp works."
      >
        <InviteManager businessId={active.business.id} invites={invites} />
      </SettingsSection>
    </>
  );
}
