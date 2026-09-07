import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { signUpAction } from '@/lib/auth/actions';

export const metadata: Metadata = { title: 'Create your account' };

export default function SignUpPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Create your account</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Set up your hotel in a few minutes. No card required.
      </p>

      <div className="mt-7">
        <AuthForm
          action={signUpAction}
          fields={[
            { name: 'fullName', label: 'Your name', autoComplete: 'name' },
            { name: 'email', label: 'Work email', type: 'email', autoComplete: 'email' },
            {
              name: 'password',
              label: 'Password',
              type: 'password',
              autoComplete: 'new-password',
              hint: 'At least 8 characters.',
            },
          ]}
          submitLabel="Create account"
          pendingLabel="Creating account…"
        />
      </div>

      <p className="mt-5 text-[13px] text-ink-500">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
          Sign in
        </Link>
      </p>
    </div>
  );
}
