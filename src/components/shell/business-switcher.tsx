'use client';

import { useTransition } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Business, MemberRole } from '@/types/domain';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import { switchBusinessAction } from '@/lib/auth/actions';
import { initialsOf } from '@/lib/utils/format';

export function BusinessSwitcher({
  memberships,
  activeId,
}: {
  memberships: Array<{ business: Business; role: MemberRole }>;
  activeId: string;
}) {
  const [pending, startTransition] = useTransition();
  const active = memberships.find((m) => m.business.id === activeId);
  if (!active) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-ink-900 disabled:opacity-60"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-accent-600 text-[11px] font-semibold text-white">
          {initialsOf(active.business.name, 'H')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-white">
            {active.business.name}
          </span>
          <span className="block text-[11px] text-ink-500">{ROLE_LABELS[active.role]}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-ink-500" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-md border border-ink-200 bg-white p-1 shadow-lg"
        >
          {memberships.map(({ business, role }) => (
            <DropdownMenu.Item
              key={business.id}
              onSelect={() =>
                startTransition(async () => {
                  await switchBusinessAction(business.id);
                })
              }
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[13px] outline-none data-[highlighted]:bg-ink-100"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink-800">{business.name}</span>
                <span className="block text-[11px] text-ink-500">{ROLE_LABELS[role]}</span>
              </span>
              {business.id === activeId ? <Check className="size-4 text-accent-600" /> : null}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-ink-100" />
          <DropdownMenu.Item asChild>
            <Link
              href="/onboarding"
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-ink-100"
            >
              <Plus className="size-4" />
              Add another hotel
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
