import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { Room } from '@/types/domain';
import { SettingsSection } from '@/components/settings/settings-section';
import { RoomsEditor } from '@/components/settings/rooms-editor';

export const metadata: Metadata = { title: 'Rooms' };

export default async function RoomsSettingsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: rooms } = await supabase
    .from('rooms')
    .select('*')
    .eq('business_id', active.business.id)
    .order('sort_order');

  return (
    <SettingsSection
      title="Room types"
      description="The assistant may only quote rooms and prices listed here. It never invents a rate."
    >
      <RoomsEditor
        businessId={active.business.id}
        rooms={(rooms ?? []) as Room[]}
        currency={active.business.currency}
      />
    </SettingsSection>
  );
}
