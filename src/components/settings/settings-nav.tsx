'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import type { Capability } from '@/lib/auth/permissions';

const ITEMS: Array<{ href: string; label: string; capability?: Capability }> = [
  { href: '/settings/hotel', label: 'Hotel', capability: 'hotel_content:manage' },
  { href: '/settings/rooms', label: 'Rooms', capability: 'hotel_content:manage' },
  { href: '/settings/availability', label: 'Availability', capability: 'availability:manage' },
  { href: '/settings/policies', label: 'Policies', capability: 'hotel_content:manage' },
  { href: '/settings/faqs', label: 'FAQs', capability: 'hotel_content:manage' },
  { href: '/settings/ai', label: 'Assistant', capability: 'business:manage' },
  { href: '/settings/follow-ups', label: 'Follow-ups', capability: 'follow_up_rules:manage' },
  { href: '/settings/whatsapp', label: 'WhatsApp', capability: 'whatsapp:manage' },
  { href: '/settings/team', label: 'Team', capability: 'staff:manage' },
  { href: '/settings/health', label: 'Health', capability: 'system_health:view' },
  { href: '/settings/profile', label: 'Your profile' },
];

export function SettingsNav({ capabilities }: { capabilities: readonly Capability[] }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((item) => !item.capability || capabilities.includes(item.capability));

  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-44 lg:flex-col lg:overflow-visible">
      {visible.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
              active ? 'bg-white text-ink-900 shadow-[0_1px_2px_rgba(16,24,40,0.06)]' : 'text-ink-500 hover:bg-white hover:text-ink-800',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
