import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireBusiness } from '@/lib/auth/session';
import { listLeads } from '@/lib/db/queries';
import { PageHeader } from '@/components/ui/page-header';
import { LeadsTable } from '@/components/leads/leads-table';

export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; q?: string }>;
}) {
  const { active } = await requireBusiness();
  const params = await searchParams;

  // hot/warm/cold are temperature filters: a lead can be "follow-up due" and
  // still be hot, and the owner expects to see it under Hot.
  const isTemperature = ['hot', 'warm', 'cold'].includes(params.status ?? '');

  const leads = await listLeads(active.business.id, {
    status: isTemperature ? 'all' : params.status,
    temperature: isTemperature ? params.status : undefined,
    sort: (params.sort as 'newest' | 'score' | 'value' | 'follow_up' | undefined) ?? 'newest',
    search: params.q,
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Leads"
        description="Every enquiry, scored and ranked. Click a guest to open the conversation."
      />
      <div className="px-6 py-5">
        <Suspense fallback={null}>
          <LeadsTable leads={leads} currency={active.business.currency} />
        </Suspense>
      </div>
    </div>
  );
}
