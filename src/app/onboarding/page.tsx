import Link from 'next/link';
import type { Metadata } from 'next';
import { requireSession } from '@/lib/auth/session';
import { CreateBusinessForm } from '@/components/settings/create-business-form';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Add your hotel' };

export default async function OnboardingPage() {
  const session = await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Add your hotel</h1>
        <p className="mt-1 text-[13px] text-ink-500">
          Each hotel is its own workspace with its own enquiries, staff and settings.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <CreateBusinessForm />
        </CardContent>
      </Card>

      {session.memberships.length > 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-[13px] font-medium text-ink-700">Hotels you already belong to</p>
            <ul className="mt-3 flex flex-col gap-2">
              {session.memberships.map(({ business, role }) => (
                <li key={business.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink-800">{business.name}</span>
                  <span className="text-[13px] text-ink-500">{role}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard"
              className="mt-4 inline-block text-[13px] font-medium text-accent-600 hover:text-accent-700"
            >
              Go to the dashboard
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
