import { requireBusiness } from '@/lib/auth/session';
import { capabilitiesFor } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui/page-header';
import { SettingsNav } from '@/components/settings/settings-nav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { active } = await requireBusiness();

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader title="Settings" description={active.business.name} />
      <div className="flex flex-1 flex-col gap-6 px-6 py-6 lg:flex-row">
        <SettingsNav capabilities={capabilitiesFor(active.role)} />
        <div className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
