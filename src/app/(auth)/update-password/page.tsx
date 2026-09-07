import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { updatePasswordAction } from '@/lib/auth/actions';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function UpdatePasswordPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Choose a new password</h1>
      <p className="mt-1 text-[13px] text-ink-500">This replaces your previous password.</p>

      <div className="mt-7">
        <AuthForm
          action={updatePasswordAction}
          fields={[
            {
              name: 'password',
              label: 'New password',
              type: 'password',
              autoComplete: 'new-password',
              hint: 'At least 8 characters.',
            },
          ]}
          submitLabel="Update password"
          pendingLabel="Updating…"
        />
      </div>
    </div>
  );
}
