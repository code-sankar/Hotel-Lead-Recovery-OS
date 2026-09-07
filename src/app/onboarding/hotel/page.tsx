import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessProfile } from '@/types/domain';
import { OnboardingSteps } from '@/components/settings/onboarding-steps';
import { HotelContactForm, HotelProfileForm } from '@/components/settings/hotel-details-form';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Hotel details' };

export default async function OnboardingHotelPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('business_id', active.business.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <OnboardingSteps current="/onboarding/hotel" />
      <HotelContactForm business={active.business} />
      <HotelProfileForm businessId={active.business.id} profile={(profile as BusinessProfile) ?? null} />
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/onboarding/rooms">Next: room types</Link>
        </Button>
      </div>
    </div>
  );
}
