import Link from 'next/link';
import type { Metadata } from 'next';
import { requireBusiness } from '@/lib/auth/session';
import { listFollowUps } from '@/lib/db/queries';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessSettings } from '@/types/domain';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge, TemperatureBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime, formatPhone, formatRelative } from '@/lib/utils/format';
import { CancelFollowUpForm } from '@/components/leads/cancel-follow-up-form';

export const metadata: Metadata = { title: 'Follow-ups' };

const TABS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sent', label: 'Sent' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
  { value: 'all', label: 'All' },
];

/** Kept out of the component so rendering stays a pure function of its props. */
function isOverdue(scheduledFor: string): boolean {
  return new Date(scheduledFor).getTime() <= Date.now();
}

const STATUS_TONE: Record<string, 'neutral' | 'warm' | 'money' | 'hot'> = {
  scheduled: 'warm',
  sent: 'money',
  cancelled: 'neutral',
  failed: 'hot',
  skipped: 'neutral',
};

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { active } = await requireBusiness();
  const params = await searchParams;
  const status = params.status ?? 'scheduled';

  const supabase = await createServerSupabase();
  const [followUps, { data: settingsRow }] = await Promise.all([
    listFollowUps(active.business.id, status),
    supabase.from('business_settings').select('*').eq('business_id', active.business.id).single(),
  ]);
  const settings = settingsRow as BusinessSettings | null;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Follow-ups"
        description="What the system will send, and what it already sent, when a guest goes quiet."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/settings/follow-ups">Follow-up settings</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-6 py-5">
        {settings && !settings.follow_ups_enabled ? (
          <p className="rounded-md bg-warm-50 px-3 py-2 text-[13px] text-warm-700">
            Automatic follow-ups are switched off for this hotel. Nothing new will be scheduled.
          </p>
        ) : null}

        <div className="flex gap-1">
          {TABS.map((tab) => (
            <Button
              key={tab.value}
              asChild
              size="sm"
              variant={status === tab.value ? 'primary' : 'secondary'}
            >
              <Link href={`/follow-ups?status=${tab.value}`}>{tab.label}</Link>
            </Button>
          ))}
        </div>

        <div className="overflow-hidden rounded-card border border-ink-200 bg-white">
          {followUps.length === 0 ? (
            <EmptyState
              title={status === 'scheduled' ? 'Nothing scheduled' : 'Nothing here'}
              description={
                status === 'scheduled'
                  ? 'A follow-up is scheduled automatically whenever a live enquiry goes quiet.'
                  : 'Try another tab.'
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Guest</TH>
                  <TH>Step</TH>
                  <TH>Status</TH>
                  <TH>Due</TH>
                  <TH>Message</TH>
                  <TH />
                </tr>
              </THead>
              <TBody>
                {followUps.map((followUp) => {
                  const due = isOverdue(followUp.scheduled_for);
                  return (
                    <TR key={followUp.id}>
                      <TD>
                        <Link
                          href={`/conversations/${followUp.lead.conversation_id}`}
                          className="font-medium text-ink-900 hover:text-accent-700"
                        >
                          {followUp.customer.name ?? formatPhone(followUp.customer.phone_number)}
                        </Link>
                        <span className="mt-0.5 block">
                          <TemperatureBadge temperature={followUp.lead.temperature} />
                        </span>
                      </TD>
                      <TD className="text-[13px]">
                        {followUp.rule?.name ?? `Step ${followUp.sequence_index}`}
                        {followUp.created_by === 'staff' ? (
                          <span className="ml-1 text-[12px] text-ink-400">(manual)</span>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[followUp.status] ?? 'neutral'}>
                          {followUp.status}
                        </Badge>
                        {followUp.last_error ? (
                          <span className="mt-1 block max-w-56 text-[11px] text-hot-600">
                            {followUp.last_error}
                          </span>
                        ) : null}
                        {followUp.cancel_reason ? (
                          <span className="mt-1 block text-[11px] text-ink-400">
                            {followUp.cancel_reason.replace(/_/g, ' ')}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-[13px] text-ink-600">
                        <span className={due && followUp.status === 'scheduled' ? 'text-warm-700' : undefined}>
                          {formatRelative(followUp.sent_at ?? followUp.scheduled_for)}
                        </span>
                        <span className="block text-[11px] text-ink-400">
                          {formatDateTime(
                            followUp.sent_at ?? followUp.scheduled_for,
                            active.business.timezone,
                          )}
                        </span>
                      </TD>
                      <TD className="max-w-sm text-[13px] text-ink-600">
                        <span className="line-clamp-2">{followUp.body}</span>
                      </TD>
                      <TD className="text-right">
                        {followUp.status === 'scheduled' ? (
                          <CancelFollowUpForm followUpId={followUp.id} />
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
