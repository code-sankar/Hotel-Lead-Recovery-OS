import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessProfile } from '@/types/domain';
import { HotelContactForm, HotelProfileForm } from '@/components/settings/hotel-details-form';

export const metadata: Metadata = { title: 'Hotel settings' };

export default async function HotelSettingsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('business_id', active.business.id)
    .maybeSingle();

  return (
    <>
      <HotelContactForm business={active.business} />
      <HotelProfileForm businessId={active.business.id} profile={(profile as BusinessProfile) ?? null} />
    </>
  );
}
