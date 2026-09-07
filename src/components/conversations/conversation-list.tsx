'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { ConversationListItem } from '@/lib/db/queries';
import { cn } from '@/lib/utils/cn';
import { formatPhone, formatRelative, initialsOf } from '@/lib/utils/format';
import { Badge, TemperatureBadge } from '@/components/ui/badge';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'Assistant' },
  { value: 'human', label: 'With staff' },
  { value: 'paused', label: 'Paused' },
] as const;

export function ConversationList({
  items,
  timezone,
}: {
  items: ConversationListItem[];
  timezone: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMode = searchParams.get('mode') ?? 'all';
  const search = searchParams.get('q') ?? '';

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'all') params.set(key, value);
    else params.delete(key);
    router.replace(`/conversations?${params.toString()}`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-ink-200 px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            defaultValue={search}
            placeholder="Search name or number"
            aria-label="Search conversations"
            onChange={(event) => updateParam('q', event.target.value)}
            className="h-9 w-full rounded-md border border-ink-200 bg-white pl-8 pr-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
        </div>
        <div className="mt-2 flex gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => updateParam('mode', filter.value)}
              className={cn(
                'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                activeMode === filter.value
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-500">
            No conversations yet. Enquiries appear here the moment they arrive.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map(({ conversation, customer, lead }) => {
              const href = `/conversations/${conversation.id}`;
              const active = pathname === href;
              return (
                <li key={conversation.id}>
                  <Link
                    href={href}
                    className={cn(
                      'flex gap-3 px-3 py-3 transition-colors',
                      active ? 'bg-accent-50' : 'hover:bg-ink-50',
                    )}
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600">
                      {initialsOf(customer.name ?? customer.phone_number)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink-900">
                          {customer.name ?? formatPhone(customer.phone_number)}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-400">
                          {formatRelative(conversation.last_message_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-500">
                        {conversation.last_message_preview || 'No messages yet'}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        {lead ? <TemperatureBadge temperature={lead.temperature} /> : null}
                        {lead ? (
                          <span className="tabular text-[11px] text-ink-400">{lead.lead_score}</span>
                        ) : null}
                        {conversation.mode === 'human' ? <Badge tone="accent">Staff</Badge> : null}
                        {conversation.mode === 'paused' ? <Badge>Paused</Badge> : null}
                        {customer.opted_out ? <Badge>Opted out</Badge> : null}
                        {conversation.unread_count > 0 ? (
                          <span className="ml-auto rounded-full bg-accent-600 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular">
                            {conversation.unread_count}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="border-t border-ink-200 px-3 py-2 text-[11px] text-ink-400">
        Times shown in {timezone}
      </p>
    </div>
  );
}
