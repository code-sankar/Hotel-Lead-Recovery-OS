import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { HotelPolicy } from '@/types/domain';
import { OnboardingSteps } from '@/components/settings/onboarding-steps';
import { SettingsSection } from '@/components/settings/settings-section';
import { PoliciesEditor } from '@/components/settings/policies-editor';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Policies' };

export default async function OnboardingPoliciesPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: policies } = await supabase
    .from('hotel_policies')
    .select('*')
    .eq('business_id', active.business.id)
    .order('created_at');

  return (
    <div className="flex flex-col gap-6">
      <OnboardingSteps current="/onboarding/policies" />
      <SettingsSection
        title="Policies"
        description="Cancellation, payment, children, pets and anything else guests ask about."
      >
        <PoliciesEditor businessId={active.business.id} policies={(policies ?? []) as HotelPolicy[]} />
      </SettingsSection>
      <div className="flex justify-between">
        <Button variant="secondary" asChild>
          <Link href="/onboarding/rooms">Back</Link>
        </Button>
        <Button asChild>
          <Link href="/onboarding/faqs">Next: FAQs</Link>
        </Button>
      </div>
    </div>
  );
}
