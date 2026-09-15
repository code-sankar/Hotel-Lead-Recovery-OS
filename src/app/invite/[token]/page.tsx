import Link from 'next/link';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth/session';
import { previewInvite } from '@/lib/team/actions';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import type { MemberRole } from '@/types/domain';
import { AcceptInvite } from '@/components/settings/accept-invite';

export const metadata: Metadata = { title: 'Join a hotel' };
export const dynamic = 'force-dynamic';

/**
 * The public side of an invitation.
 *
 * Reachable signed out, because the recipient usually does not have an account
 * yet. Nothing is granted here — accepting goes through a SECURITY DEFINER RPC
 * that re-checks the token, the expiry and the email.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session] = await Promise.all([previewInvite(token), getSession()]);

  if (!invite) {
    return (
      <Shell title="This invitation link is not valid">
        <p className="text-[13px] text-ink-600">
          It may have been mistyped or already replaced. Ask whoever invited you to send a new one.
        </p>
      </Shell>
    );
  }

  if (invite.status !== 'pending') {
    const reason = {
      accepted: 'This invitation has already been used.',
      expired: 'This invitation has expired.',
      revoked: 'This invitation was revoked.',
      pending: '',
    }[invite.status];

    return (
      <Shell title={`Invitation to ${invite.businessName}`}>
        <p className="text-[13px] text-ink-600">{reason} Ask for a new link.</p>
        {session ? (
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-[13px] font-medium text-accent-600 hover:text-accent-700"
          >
            Go to your dashboard
          </Link>
        ) : null}
      </Shell>
    );
  }

  const signedInAs = session?.user.email ?? null;
  const emailMatches = signedInAs?.toLowerCase() === invite.email.toLowerCase();

  return (
    <Shell title={`Join ${invite.businessName}`}>
      <p className="text-[13px] text-ink-600">
        You have been invited to {invite.businessName} as{' '}
        <strong className="font-medium text-ink-800">
          {ROLE_LABELS[invite.role as MemberRole] ?? invite.role}
        </strong>
        .
      </p>

      {!session ? (
        <div className="mt-5">
          <p className="text-[13px] text-ink-600">
            Sign in as <strong className="font-medium text-ink-800">{invite.email}</strong> to
            accept, or create an account with that address.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href={`/login?next=/invite/${token}`}
              className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center rounded-md border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-50"
            >
              Create an account
            </Link>
          </div>
        </div>
      ) : !emailMatches ? (
        <div className="mt-5">
          <p className="rounded-md bg-warm-50 px-3 py-2.5 text-[13px] text-warm-700">
            This invitation was sent to <strong>{invite.email}</strong>, but you are signed in as{' '}
            <strong>{signedInAs}</strong>. Sign in with the invited address, or ask for an invite to
            this one.
          </p>
          <Link
            href={`/login?next=/invite/${token}`}
            className="mt-4 inline-block text-[13px] font-medium text-accent-600 hover:text-accent-700"
          >
            Sign in with a different account
          </Link>
        </div>
      ) : (
        <div className="mt-5">
          <AcceptInvite token={token} businessName={invite.businessName} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="text-[13px] font-semibold tracking-tight text-ink-900">Lead Stay</p>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
      <div className="mt-2">{children}</div>
    </main>
  );
}
