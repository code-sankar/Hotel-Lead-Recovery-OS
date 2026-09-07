import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { HotelFaq } from '@/types/domain';
import { SettingsSection } from '@/components/settings/settings-section';
import { FaqsEditor } from '@/components/settings/faqs-editor';

export const metadata: Metadata = { title: 'FAQs' };

export default async function FaqsSettingsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: faqs } = await supabase
    .from('hotel_faqs')
    .select('*')
    .eq('business_id', active.business.id)
    .order('sort_order');

  return (
    <SettingsSection title="Frequently asked questions" description="The quickest way to make replies more useful.">
      <FaqsEditor businessId={active.business.id} faqs={(faqs ?? []) as HotelFaq[]} />
    </SettingsSection>
  );
}
