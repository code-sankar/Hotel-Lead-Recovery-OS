import { notFound } from 'next/navigation';
import { after } from 'next/server';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireBusiness } from '@/lib/auth/session';
import { getConversationDetail, listConversations, listTeamMembers } from '@/lib/db/queries';
import { createServerSupabase } from '@/lib/db/server-client';
import { storeForBusiness } from '@/lib/db/user-store';
import { checkAvailability } from '@/lib/availability/service';
import type { Room } from '@/types/domain';
import { isServiceWindowOpen } from '@/lib/messaging/window';
import { ConversationList } from '@/components/conversations/conversation-list';
import { MessageThread } from '@/components/conversations/message-thread';
import { Composer } from '@/components/conversations/composer';
import { ConversationActions } from '@/components/conversations/conversation-actions';
import { LeadPanel } from '@/components/conversations/lead-panel';
import { Badge } from '@/components/ui/badge';
import { formatPhone } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Conversation' };

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { active } = await requireBusiness();
  const { conversationId } = await params;
  const query = await searchParams;

  const [detail, items, team] = await Promise.all([
    getConversationDetail(active.business.id, conversationId),
    listConversations(active.business.id, { search: query.q, mode: query.mode }),
    listTeamMembers(active.business.id),
  ]);

  if (!detail) notFound();

  // The same lookup the assistant is held to, so staff see exactly what it saw.
  const supabase = await createServerSupabase();

  // Reading a conversation is what clears its badge. Previously the count only
  // reset on take-over or resolve, so the inbox stayed permanently unread.
  // The client is built here, during render, because `after` in a Server
  // Component may not touch request APIs such as cookies().
  if (detail.conversation.unread_count > 0) {
    after(async () => {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('business_id', active.business.id)
        .eq('id', detail.conversation.id);
    });
  }
  const { data: roomRows } = await supabase
    .from('rooms')
    .select('*')
    .eq('business_id', active.business.id)
    .eq('active', true)
    .order('sort_order');
  const rooms = (roomRows ?? []) as Room[];

  const availability = detail.lead
    ? await checkAvailability(
        storeForBusiness(supabase),
        active.business.id,
        rooms.map((room) => ({
          id: room.id,
          name: room.name,
          basePrice: Number(room.base_price),
          maxGuests: room.max_guests,
          totalUnits: room.total_units,
        })),
        {
          checkIn: detail.lead.expected_check_in,
          checkOut: detail.lead.expected_check_out,
          guests: detail.lead.guests,
        },
      )
    : null;

  const customerName = detail.customer.name ?? formatPhone(detail.customer.phone_number);
  const windowOpen = isServiceWindowOpen(detail.conversation.last_inbound_at);

  return (
    <>
      <div className="hidden w-80 shrink-0 border-r border-ink-200 bg-white lg:block">
        <Suspense fallback={null}>
          <ConversationList items={items} timezone={active.business.timezone} />
        </Suspense>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-ink-50">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-6 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-sm font-semibold text-ink-900">{customerName}</h1>
              {detail.conversation.mode === 'human' ? <Badge tone="accent">Staff handling</Badge> : null}
              {detail.conversation.mode === 'paused' ? <Badge>Assistant paused</Badge> : null}
              {detail.customer.opted_out ? <Badge tone="hot">Opted out</Badge> : null}
              {active.business.messaging_mode === 'demo' ? <Badge tone="warm">Demo</Badge> : null}
            </div>
            <p className="text-[12px] text-ink-500">{formatPhone(detail.customer.phone_number)}</p>
          </div>
          <ConversationActions
            conversationId={detail.conversation.id}
            mode={detail.conversation.mode}
            resolved={detail.conversation.status === 'resolved'}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <MessageThread
            messages={detail.messages}
            timezone={active.business.timezone}
            customerName={customerName}
          />
        </div>

        <Composer
          conversationId={detail.conversation.id}
          mode={detail.conversation.mode}
          optedOut={detail.customer.opted_out}
          windowOpen={windowOpen}
        />
      </div>

      <div className="hidden xl:block">
        <LeadPanel
          lead={detail.lead}
          events={detail.events}
          notes={detail.notes}
          followUps={detail.followUps}
          team={team}
          currency={active.business.currency}
          timezone={active.business.timezone}
          availability={availability}
          rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
        />
      </div>
    </>
  );
}
