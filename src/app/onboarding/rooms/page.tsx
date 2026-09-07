import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { Room } from '@/types/domain';
import { OnboardingSteps } from '@/components/settings/onboarding-steps';
import { SettingsSection } from '@/components/settings/settings-section';
import { RoomsEditor } from '@/components/settings/rooms-editor';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Room types' };

export default async function OnboardingRoomsPage() {
  const { active } = await requireCapability('hotel_content:manage');
  const supabase = await createServerSupabase();
  const { data: rooms } = await supabase
    .from('rooms')
    .select('*')
    .eq('business_id', active.business.id)
    .order('sort_order');

  return (
    <div className="flex flex-col gap-6">
      <OnboardingSteps current="/onboarding/rooms" />
      <SettingsSection
        title="Room types"
        description="These are the only rooms and prices the assistant is allowed to quote."
      >
        <RoomsEditor
          businessId={active.business.id}
          rooms={(rooms ?? []) as Room[]}
          currency={active.business.currency}
        />
      </SettingsSection>
      <div className="flex justify-between">
        <Button variant="secondary" asChild>
          <Link href="/onboarding/hotel">Back</Link>
        </Button>
        <Button asChild>
          <Link href="/onboarding/policies">Next: policies</Link>
        </Button>
      </div>
    </div>
  );
}
