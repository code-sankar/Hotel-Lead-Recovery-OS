import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { SettingsSection } from '@/components/settings/settings-section';
import { SettingsForm } from '@/components/settings/settings-form';
import { Field, Input } from '@/components/ui/input';
import { updateProfileAction } from '@/lib/auth/actions';
import { ROLE_LABELS } from '@/lib/auth/permissions';

export const metadata: Metadata = { title: 'Your profile' };

export default async function ProfileSettingsPage() {
  const session = await requireSession();

  return (
    <>
      <SettingsSection title="Your profile" description="How you appear to the rest of your team.">
        <SettingsForm action={updateProfileAction}>
          {(errors) => (
            <>
              <Field label="Full name" htmlFor="fullName" error={errors.fullName}>
                <Input id="fullName" name="fullName" defaultValue={session.profile?.full_name ?? ''} required />
              </Field>
              <Field label="Email" htmlFor="email" hint="Contact support to change your sign-in email.">
                <Input id="email" defaultValue={session.user.email ?? ''} disabled />
              </Field>
              <Field label="Phone" htmlFor="phone" error={errors.phone}>
                <Input id="phone" name="phone" defaultValue={session.profile?.phone ?? ''} />
              </Field>
            </>
          )}
        </SettingsForm>
      </SettingsSection>

      <SettingsSection title="Your hotels" description="Where you have access and with which role.">
        <ul className="flex flex-col divide-y divide-ink-100">
          {session.memberships.map(({ business, role }) => (
            <li key={business.id} className="flex items-center justify-between py-2.5 first:pt-0">
              <span className="text-sm text-ink-800">{business.name}</span>
              <span className="text-[13px] text-ink-500">{ROLE_LABELS[role]}</span>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}
