'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { LogOut, UserRound } from 'lucide-react';
import { signOutAction } from '@/lib/auth/actions';
import { initialsOf } from '@/lib/utils/format';

export function UserMenu({ name, email }: { name: string | null; email: string | null }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-ink-900">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-[11px] font-semibold text-ink-200">
          {initialsOf(name ?? email)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink-100">
            {name ?? 'Your account'}
          </span>
          <span className="block truncate text-[11px] text-ink-500">{email}</span>
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-56 rounded-md border border-ink-200 bg-white p-1 shadow-lg"
        >
          <DropdownMenu.Item asChild>
            <Link
              href="/settings/profile"
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-ink-100"
            >
              <UserRound className="size-4" />
              Your profile
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-ink-100" />
          <DropdownMenu.Item asChild>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-[13px] text-ink-700 outline-none data-[highlighted]:bg-ink-100"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </form>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
