import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { signInAction } from '@/lib/auth/actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-500">Welcome back to your enquiry inbox.</p>

      <div className="mt-7">
        <AuthForm
          action={signInAction}
          hiddenFields={next ? { next } : undefined}
          fields={[
            { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
            { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
          ]}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
        />
      </div>

      <div className="mt-5 flex items-center justify-between text-[13px]">
        <Link href="/reset-password" className="text-ink-500 hover:text-ink-800">
          Forgot password?
        </Link>
        <Link href="/signup" className="font-medium text-accent-600 hover:text-accent-700">
          Create an account
        </Link>
      </div>
    </div>
  );
}
