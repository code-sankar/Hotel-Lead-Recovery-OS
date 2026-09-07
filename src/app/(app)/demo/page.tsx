import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env';
import { createServerSupabase } from '@/lib/db/server-client';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { DemoConsole } from '@/components/dashboard/demo-console';

export const metadata: Metadata = { title: 'Demo mode' };

export default async function DemoPage() {
  const { active } = await requireCapability('demo:run');
  if (!serverEnv().DEMO_MODE_ENABLED) notFound();

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('leads')
    .select('id, conversation_id, next_follow_up_at, customers!inner(name, phone_number)')
    .eq('business_id', active.business.id)
    .in('status', ['new', 'active', 'follow_up_due', 'hot', 'warm', 'cold'])
    .order('created_at', { ascending: false })
    .limit(50);

  const openLeads = ((data ?? []) as unknown as Array<{
    id: string;
    conversation_id: string;
    next_follow_up_at: string | null;
    customers: { name: string | null; phone_number: string };
  }>).map((lead) => ({
    id: lead.id,
    conversationId: lead.conversation_id,
    name: lead.customers.name ?? lead.customers.phone_number,
    hasPendingFollowUp: Boolean(lead.next_follow_up_at),
  }));

  const isDemo = active.business.messaging_mode === 'demo';

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Demo mode"
        description="Run the complete enquiry → follow-up → conversion flow without a live WhatsApp number."
        actions={isDemo ? <Badge tone="warm">Demo mode</Badge> : <Badge tone="money">Live mode</Badge>}
      />

      <div className="flex flex-col gap-5 px-6 py-5">
        {!isDemo ? (
          <p className="rounded-md bg-hot-50 px-3 py-2.5 text-[13px] text-hot-700">
            This hotel is in live mode, so demo tools are disabled — simulated traffic must never mix
            with a real WhatsApp inbox. Switch to demo mode in Settings → WhatsApp to use them.
          </p>
        ) : (
          <p className="rounded-md bg-warm-50 px-3 py-2.5 text-[13px] text-warm-700">
            Nothing on this page reaches Meta. Messages the assistant produces are stored with a
            <strong className="mx-1 font-semibold">demo · not sent</strong> label so they are never
            mistaken for delivered WhatsApp messages.
          </p>
        )}

        <DemoConsole businessId={active.business.id} openLeads={openLeads} />
      </div>
    </div>
  );
}
