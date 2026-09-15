'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import type { SystemEvent } from '@/types/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { resolveSystemEventAction } from '@/lib/monitoring/actions';

/** Plain-language names for the scopes the app records against. */
const SCOPE_LABELS: Record<string, string> = {
  'whatsapp.webhook': 'Incoming WhatsApp',
  'messaging.outbound': 'Sending a message',
  'followup.send': 'Sending a follow-up',
  'ai.guardrail': 'Assistant reply blocked',
  'job.process_inbound_message': 'Processing an enquiry',
  'job.execute_follow_up': 'Running a follow-up',
  'job.sweep_follow_ups': 'Follow-up sweep',
  monitoring: 'Monitoring itself',
};

export function HealthLog({
  businessId,
  events,
  timezone,
}: {
  businessId: string;
  events: SystemEvent[];
  timezone: string;
}) {
  const [pending, startTransition] = useTransition();

  if (events.length === 0) {
    return (
      <p className="text-[13px] text-ink-600">
        Nothing has failed. Errors from incoming WhatsApp messages, replies, follow-ups and
        background jobs appear here as soon as they happen.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-ink-100">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={event.level === 'error' ? 'hot' : 'warm'}>
                {event.level === 'error' ? 'Error' : 'Warning'}
              </Badge>
              <span className="text-[13px] font-medium text-ink-900">
                {SCOPE_LABELS[event.scope] ?? event.scope}
              </span>
              {event.occurrences > 1 ? (
                <Badge>{event.occurrences} times</Badge>
              ) : null}
              {event.resolved_at ? <Badge tone="money">Resolved</Badge> : null}
            </div>

            <p className="mt-1 text-[13px] text-ink-700">{event.message}</p>

            <p className="mt-1 text-[11px] text-ink-400">
              Last seen {formatRelative(event.last_seen_at)} ·{' '}
              {formatDateTime(event.last_seen_at, timezone)}
              {event.occurrences > 1 ? ` · first seen ${formatRelative(event.first_seen_at)}` : ''}
            </p>
          </div>

          {!event.resolved_at ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await resolveSystemEventAction(businessId, event.id);
                  if (result.ok) toast.success('Marked as looked at.');
                  else toast.error(result.error ?? 'That did not work.');
                })
              }
            >
              Mark looked at
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
