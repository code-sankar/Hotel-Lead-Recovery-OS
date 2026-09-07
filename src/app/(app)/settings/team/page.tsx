import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { listTeamMembers } from '@/lib/db/queries';
import { SettingsSection } from '@/components/settings/settings-section';
import { TeamTable } from '@/components/settings/team-table';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamSettingsPage() {
  const { active, user } = await requireCapability('staff:manage');
  const members = await listTeamMembers(active.business.id);

  return (
    <>
      <SettingsSection title="Team" description="Who can see and act on this hotel’s enquiries.">
        <TeamTable businessId={active.business.id} currentUserId={user.id} members={members} />
      </SettingsSection>

      <SettingsSection title="Adding a colleague" description="How to bring someone onto this hotel.">
        <p className="text-[13px] leading-relaxed text-ink-600">
          Ask them to create an account at{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">/signup</code>, then add them
          to this hotel from your Supabase project by inserting a row in{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">business_members</code> with
          their user id and a role. Self-service email invitations are not part of this MVP.
        </p>
      </SettingsSection>
    </>
  );
}
