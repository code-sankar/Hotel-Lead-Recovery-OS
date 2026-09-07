import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { requestPasswordResetAction } from '@/lib/auth/actions';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reset your password</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        We will email you a link to choose a new password.
      </p>

      <div className="mt-7">
        <AuthForm
          action={requestPasswordResetAction}
          fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }]}
          submitLabel="Send reset link"
          pendingLabel="Sending…"
        />
      </div>

      <p className="mt-5 text-[13px]">
        <Link href="/login" className="text-ink-500 hover:text-ink-800">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
