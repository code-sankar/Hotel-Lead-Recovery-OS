import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireBusiness } from '@/lib/auth/session';
import { listConversations } from '@/lib/db/queries';
import { ConversationList } from '@/components/conversations/conversation-list';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Conversations' };

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { active } = await requireBusiness();
  const params = await searchParams;
  const items = await listConversations(active.business.id, {
    search: params.q,
    mode: params.mode,
  });

  return (
    <>
      <div className="w-80 shrink-0 border-r border-ink-200 bg-white">
        <Suspense fallback={null}>
          <ConversationList items={items} timezone={active.business.timezone} />
        </Suspense>
      </div>
      <div className="flex flex-1 items-center justify-center bg-ink-50">
        <EmptyState
          title="Select a conversation"
          description={
            items.length === 0
              ? 'No enquiries yet. Connect WhatsApp, or use Demo mode to simulate one and watch the whole flow run.'
              : 'Pick a conversation from the list to read it and take over if you need to.'
          }
        />
      </div>
    </>
  );
}
