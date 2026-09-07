import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { HotelFaq } from '@/types/domain';
import { OnboardingSteps } from '@/components/settings/onboarding-steps';
import { SettingsSection } from '@/components/settings/settings-section';
import { FaqsEditor } from '@/components/settings/faqs-editor';
import { Button } from '@/components/ui/button';
import { completeOnboardingAction } from '@/lib/settings/actions';

export const metadata: Metadata = { title: 'FAQs' };

export default async function OnboardingFaqsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: faqs } = await supabase
    .from('hotel_faqs')
    .select('*')
    .eq('business_id', active.business.id)
    .order('sort_order');

  const finish = completeOnboardingAction.bind(null, active.business.id);

  return (
    <div className="flex flex-col gap-6">
      <OnboardingSteps current="/onboarding/faqs" />
      <SettingsSection
        title="Frequently asked questions"
        description="Answers the assistant can give word for word."
      >
        <FaqsEditor businessId={active.business.id} faqs={(faqs ?? []) as HotelFaq[]} />
      </SettingsSection>
      <div className="flex items-center justify-between">
        <Button variant="secondary" asChild>
          <Link href="/onboarding/policies">Back</Link>
        </Button>
        <form action={finish}>
          <Button type="submit">Finish setup</Button>
        </form>
      </div>
    </div>
  );
}
