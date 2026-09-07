import Link from 'next/link';
import type { ActivityItem } from '@/lib/analytics/metrics';
import { formatRelative } from '@/lib/utils/format';

function describe(item: ActivityItem): string {
  switch (item.type) {
    case 'lead_created':
      return `${item.customerName} sent a new enquiry`;
    case 'follow_up_sent':
      return `${item.customerName} received a follow-up`;
    case 'human_takeover':
      return `Conversation with ${item.customerName} moved to your team`;
    case 'lead_converted':
      return `${item.customerName} converted`;
    case 'lead_lost':
      return `${item.customerName} was marked lost`;
    case 'customer_opted_out':
      return `${item.customerName} opted out of messages`;
    default:
      return `${item.customerName} — ${item.type.replace(/_/g, ' ')}`;
  }
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-ink-500">Nothing has happened yet.</p>;
  }

  return (
    <ol className="flex flex-col divide-y divide-ink-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
          {item.conversationId ? (
            <Link
              href={`/conversations/${item.conversationId}`}
              className="text-[13px] text-ink-700 hover:text-accent-700"
            >
              {describe(item)}
            </Link>
          ) : (
            <span className="text-[13px] text-ink-700">{describe(item)}</span>
          )}
          <span className="shrink-0 text-[11px] text-ink-400">{formatRelative(item.at)}</span>
        </li>
      ))}
    </ol>
  );
}
