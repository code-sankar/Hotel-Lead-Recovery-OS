'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { LeadListItem } from '@/lib/db/queries';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LeadStatusBadge, TemperatureBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/input';
import { INTENT_LABELS } from '@/lib/ai/intent';
import { formatCurrency, formatPhone, formatRelative } from '@/lib/utils/format';

const STATUS_FILTERS = [
  { value: 'all', label: 'All leads' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
  { value: 'follow_up_due', label: 'Follow-up due' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'score', label: 'Highest score' },
  { value: 'value', label: 'Highest value' },
  { value: 'follow_up', label: 'Follow-up due first' },
];

export function LeadsTable({
  leads,
  currency,
}: {
  leads: LeadListItem[];
  currency: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? 'all';
  const sort = searchParams.get('sort') ?? 'newest';

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') params.set(key, value);
    else params.delete(key);
    router.replace(`/leads?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter leads"
          value={status}
          onChange={(event) => update('status', event.target.value)}
          className="w-44"
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Sort leads"
          value={sort}
          onChange={(event) => update('sort', event.target.value)}
          className="w-48"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[13px] text-ink-500">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-ink-200 bg-white">
        {leads.length === 0 ? (
          <EmptyState
            title="No leads match this view"
            description="Change the filter, or wait for the next enquiry to arrive."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Guest</TH>
                <TH className="text-right">Score</TH>
                <TH>Temperature</TH>
                <TH>Intent</TH>
                <TH className="text-right">Est. value</TH>
                <TH>Status</TH>
                <TH>Last activity</TH>
                <TH>Next follow-up</TH>
                <TH>Assigned</TH>
              </tr>
            </THead>
            <TBody>
              {leads.map((lead) => (
                <TR key={lead.id}>
                  <TD>
                    <Link
                      href={`/conversations/${lead.conversation_id}`}
                      className="font-medium text-ink-900 hover:text-accent-700"
                    >
                      {lead.customer.name ?? formatPhone(lead.customer.phone_number)}
                    </Link>
                    <span className="block text-[12px] text-ink-400">
                      {formatPhone(lead.customer.phone_number)}
                    </span>
                  </TD>
                  <TD className="text-right tabular font-medium text-ink-800">{lead.lead_score}</TD>
                  <TD>
                    <TemperatureBadge temperature={lead.temperature} />
                  </TD>
                  <TD className="text-[13px]">{INTENT_LABELS[lead.intent]}</TD>
                  <TD className="text-right tabular">
                    {lead.status === 'converted'
                      ? formatCurrency(Number(lead.conversion_value), currency)
                      : formatCurrency(lead.estimated_value ? Number(lead.estimated_value) : null, currency)}
                  </TD>
                  <TD>
                    <LeadStatusBadge status={lead.status} />
                  </TD>
                  <TD className="text-[13px] text-ink-500">
                    {formatRelative(lead.last_customer_message_at ?? lead.created_at)}
                  </TD>
                  <TD className="text-[13px] text-ink-500">
                    {lead.next_follow_up_at ? formatRelative(lead.next_follow_up_at) : '—'}
                  </TD>
                  <TD className="text-[13px] text-ink-500">{lead.assignee?.full_name ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
