import Link from 'next/link';
import { requireBusiness } from '@/lib/auth/session';
import { capabilitiesFor } from '@/lib/auth/permissions';
import { countOpenWork } from '@/lib/db/queries';
import { serverEnv } from '@/lib/env';
import { SidebarNav } from '@/components/shell/nav';
import { BusinessSwitcher } from '@/components/shell/business-switcher';
import { UserMenu } from '@/components/shell/user-menu';
import { Badge } from '@/components/ui/badge';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { active, memberships, user, profile } = await requireBusiness();
  const counts = await countOpenWork(active.business.id);
  const demoEnabled = serverEnv().DEMO_MODE_ENABLED && active.business.messaging_mode === 'demo';

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 md:flex">
        <div className="border-b border-ink-800 px-2 py-2.5">
          <BusinessSwitcher memberships={memberships} activeId={active.business.id} />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <SidebarNav
            capabilities={capabilitiesFor(active.role)}
            counts={counts}
            demoEnabled={demoEnabled}
          />
        </div>

        {active.business.messaging_mode === 'demo' ? (
          <div className="mx-3 mb-2 rounded-md border border-warm-700/40 bg-warm-600/10 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-warm-200">
              Demo mode
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              Messages are simulated locally. Nothing is sent through WhatsApp.
            </p>
            <Link
              href="/settings/whatsapp"
              className="mt-1.5 inline-block text-[11px] font-medium text-warm-200 underline underline-offset-2"
            >
              Connect WhatsApp
            </Link>
          </div>
        ) : null}

        <div className="border-t border-ink-800 px-2 py-2">
          <UserMenu name={profile?.full_name ?? null} email={user.email ?? null} />
        </div>
      </aside>

      {/* Compact top bar on small screens; the product is desktop-first. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-ink-200 bg-ink-950 px-4 py-2.5 md:hidden">
          <span className="text-[13px] font-semibold text-white">{active.business.name}</span>
          {active.business.messaging_mode === 'demo' ? <Badge tone="warm">Demo</Badge> : null}
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
