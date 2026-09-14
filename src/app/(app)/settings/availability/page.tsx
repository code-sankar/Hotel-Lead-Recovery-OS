import Link from 'next/link';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { Room } from '@/types/domain';
import { availabilityCalendar } from '@/lib/availability/service';
import { SettingsSection } from '@/components/settings/settings-section';
import { AvailabilityGrid } from '@/components/settings/availability-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { storeForBusiness } from '@/lib/db/user-store';

export const metadata: Metadata = { title: 'Availability' };

const DEFAULT_DAYS = 21;

export default async function AvailabilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; days?: string }>;
}) {
  const { active } = await requireCapability('availability:manage');
  const params = await searchParams;

  const days = Math.min(60, Math.max(7, Number(params.days) || DEFAULT_DAYS));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '')
    ? (params.from as string)
    : new Date().toISOString().slice(0, 10);

  const supabase = await createServerSupabase();
  const { data: roomRows } = await supabase
    .from('rooms')
    .select('*')
    .eq('business_id', active.business.id)
    .eq('active', true)
    .order('sort_order');

  const rooms = (roomRows ?? []) as Room[];

  const snapshot =
    rooms.length > 0
      ? await availabilityCalendar(
          storeForBusiness(supabase),
          active.business.id,
          rooms.map((room) => ({
            id: room.id,
            name: room.name,
            basePrice: Number(room.base_price),
            maxGuests: room.max_guests,
            totalUnits: room.total_units,
          })),
          from,
          days,
        )
      : null;

  return (
    <>
      <SettingsSection
        title="Availability"
        description="What the assistant is allowed to tell a guest is free. Everything here is computed from your room counts, your closures and your confirmed bookings."
      >
        {rooms.length === 0 || !snapshot ? (
          <EmptyState
            title="Add a room type first"
            description="Availability is counted per room type, so there is nothing to show until you have at least one."
            action={
              <Button asChild size="sm">
                <Link href="/settings/rooms">Add room types</Link>
              </Button>
            }
          />
        ) : (
          <AvailabilityGrid
            businessId={active.business.id}
            snapshot={snapshot}
            from={from}
            days={days}
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="How the assistant uses this"
        description="The rule that replaced “never claim availability”."
      >
        <ul className="flex flex-col gap-2 text-[13px] text-ink-600">
          {[
            'When a guest gives dates, the app looks them up here before the assistant writes anything.',
            'The assistant may only say a room is free if this page says it is free, for exactly those dates.',
            'If it claims availability that these numbers do not support — or wrongly says you are full — the reply is blocked and the conversation goes to your team.',
            'With no dates in the conversation, nothing is looked up and the assistant still defers to your team.',
            'Confirmed bookings recorded when you mark a lead converted are subtracted here automatically.',
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-400" />
              {line}
            </li>
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}
