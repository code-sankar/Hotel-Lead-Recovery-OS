'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { BusinessInvite, MemberRole } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS } from '@/lib/auth/permissions';
import { formatRelative } from '@/lib/utils/format';
import { createInviteAction, revokeInviteAction } from '@/lib/team/actions';

const ROLES: MemberRole[] = ['staff', 'manager', 'owner'];

export function InviteManager({
  businessId,
  invites,
}: {
  businessId: string;
  invites: BusinessInvite[];
}) {
  const [pending, startTransition] = useTransition();
  // The link is shown once, right after it is created. It is never re-readable,
  // because the database only holds its hash.
  const [freshLink, setFreshLink] = useState<{ url: string; email: string } | null>(null);

  function invite(formData: FormData) {
    startTransition(async () => {
      const result = await createInviteAction(businessId, formData);
      if (!result.ok) {
        toast.error(result.error ?? 'That did not work.');
        return;
      }
      if (result.url) {
        setFreshLink({ url: result.url, email: String(formData.get('email') ?? '') });
      }
      toast.success(result.message ?? 'Invitation created.');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={invite} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Field label="Their email" htmlFor="inviteEmail">
            <Input
              id="inviteEmail"
              name="email"
              type="email"
              placeholder="colleague@hotel.com"
              required
            />
          </Field>
          <Field label="Role" htmlFor="inviteRole">
            <Select id="inviteRole" name="role" defaultValue="staff">
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>
            <Send className="size-4" />
            {pending ? 'Creating…' : 'Create invite'}
          </Button>
        </div>
      </form>

      {freshLink ? <FreshLink url={freshLink.url} email={freshLink.email} /> : null}

      <PendingInvites businessId={businessId} invites={invites} />
    </div>
  );
}

function FreshLink({ url, email }: { url: string; email: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.');
    }
  }

  return (
    <div className="rounded-md border border-accent-200 bg-accent-50/50 px-4 py-3.5">
      <p className="text-[13px] font-medium text-ink-800">Send this link to {email}</p>
      <p className="mt-0.5 text-[13px] text-ink-600">
        It is shown once and works only for this address. WhatsApp is fine — it expires in 7 days.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-3 py-2 font-mono text-[12px] text-ink-700"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function statusOf(invite: BusinessInvite): { label: string; tone: 'accent' | 'money' | 'neutral' | 'warm' } {
  if (invite.revoked_at) return { label: 'Revoked', tone: 'neutral' };
  if (invite.accepted_at) return { label: 'Accepted', tone: 'money' };
  if (new Date(invite.expires_at) <= new Date()) return { label: 'Expired', tone: 'warm' };
  return { label: 'Pending', tone: 'accent' };
}

function PendingInvites({
  businessId,
  invites,
}: {
  businessId: string;
  invites: BusinessInvite[];
}) {
  const [pending, startTransition] = useTransition();

  if (invites.length === 0) {
    return (
      <p className="text-[13px] text-ink-500">
        No invitations yet. Create one above and send the link to your colleague.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-ink-100 border-t border-ink-200 pt-1">
      {invites.map((invite) => {
        const status = statusOf(invite);
        const isOpen = !invite.revoked_at && !invite.accepted_at;
        return (
          <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink-900">
                {invite.email}
                <Badge tone={status.tone}>{status.label}</Badge>
              </p>
              <p className="text-[12px] text-ink-500">
                {ROLE_LABELS[invite.role]} ·{' '}
                {invite.accepted_at
                  ? `joined ${formatRelative(invite.accepted_at)}`
                  : `expires ${formatRelative(invite.expires_at)}`}
              </p>
            </div>
            {isOpen ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await revokeInviteAction(businessId, invite.id);
                    if (result.ok) toast.success(result.message ?? 'Revoked.');
                    else toast.error(result.error ?? 'That did not work.');
                  })
                }
                className="text-hot-600 hover:bg-hot-50 hover:text-hot-700"
              >
                Revoke
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
