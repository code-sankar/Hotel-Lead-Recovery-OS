'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  Timer,
  Users,
  FlaskConical,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Capability } from '@/lib/auth/permissions';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
  badge?: number;
}

export function SidebarNav({
  capabilities,
  counts,
  demoEnabled,
}: {
  capabilities: readonly Capability[];
  counts: { conversations: number; followUpsDue: number; openIssues: number };
  demoEnabled: boolean;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      href: '/conversations',
      label: 'Conversations',
      icon: MessagesSquare,
      badge: counts.conversations || undefined,
    },
    { href: '/leads', label: 'Leads', icon: Users },
    {
      href: '/follow-ups',
      label: 'Follow-ups',
      icon: Timer,
      badge: counts.followUpsDue || undefined,
    },
    { href: '/analytics', label: 'Analytics', icon: BarChart3, capability: 'analytics:view' },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  // Only surfaced when something is actually wrong; a permanently visible
  // "Health" link trains people to ignore it.
  if (counts.openIssues > 0 && capabilities.includes('system_health:view')) {
    items.splice(items.length - 1, 0, {
      href: '/settings/health',
      label: 'Health',
      icon: AlertTriangle,
      capability: 'system_health:view',
      badge: counts.openIssues,
    });
  }

  if (demoEnabled) {
    items.push({ href: '/demo', label: 'Demo mode', icon: FlaskConical, capability: 'demo:run' });
  }

  const visible = items.filter((item) => !item.capability || capabilities.includes(item.capability));

  return (
    <nav className="flex flex-col gap-0.5 px-3 py-3">
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
              active ? 'bg-ink-800 text-white' : 'text-ink-400 hover:bg-ink-900 hover:text-ink-100',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular',
                  active ? 'bg-ink-700 text-ink-100' : 'bg-ink-800 text-ink-300',
                )}
              >
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
