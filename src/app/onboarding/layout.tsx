import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { signOutAction } from '@/lib/auth/actions';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink-900">
            Lead Stay
          </Link>
          <div className="flex items-center gap-3 text-[13px] text-ink-500">
            {session.active ? (
              <Link href="/dashboard" className="hover:text-ink-800">
                Skip to dashboard
              </Link>
            ) : null}
            <form action={signOutAction}>
              <button type="submit" className="hover:text-ink-800">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
