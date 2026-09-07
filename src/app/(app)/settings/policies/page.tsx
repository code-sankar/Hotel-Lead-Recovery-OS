import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { HotelPolicy } from '@/types/domain';
import { SettingsSection } from '@/components/settings/settings-section';
import { PoliciesEditor } from '@/components/settings/policies-editor';

export const metadata: Metadata = { title: 'Policies' };

export default async function PoliciesSettingsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: policies } = await supabase
    .from('hotel_policies')
    .select('*')
    .eq('business_id', active.business.id)
    .order('created_at');

  return (
    <SettingsSection
      title="Policies"
      description="Quoted word for word by the assistant. Anything not here is escalated to your team."
    >
      <PoliciesEditor businessId={active.business.id} policies={(policies ?? []) as HotelPolicy[]} />
    </SettingsSection>
  );
}
