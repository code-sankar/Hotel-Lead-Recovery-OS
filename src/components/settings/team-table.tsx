'use client';

import { useTransition } from 'react';
import type { MemberRole } from '@/types/domain';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/auth/permissions';
import { removeMemberAction, updateMemberRoleAction } from '@/lib/settings/actions';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const ROLES: MemberRole[] = ['owner', 'manager', 'staff'];

export function TeamTable({
  businessId,
  currentUserId,
  members,
}: {
  businessId: string;
  currentUserId: string;
  members: Array<{ userId: string; role: string; profile: { full_name: string | null; email: string | null } | null }>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col divide-y divide-ink-100">
      {members.map((member) => {
        const isSelf = member.userId === currentUserId;
        return (
          <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                {member.profile?.full_name ?? 'Team member'}
                {isSelf ? <Badge>You</Badge> : null}
              </p>
              <p className="text-[13px] text-ink-500">{member.profile?.email ?? '—'}</p>
            </div>
            <div className="flex items-center gap-2">
              {isSelf ? (
                <span className="text-[13px] text-ink-500">{ROLE_LABELS[member.role as MemberRole]}</span>
              ) : (
                <>
                  <Select
                    aria-label={`Role for ${member.profile?.full_name ?? 'team member'}`}
                    defaultValue={member.role}
                    disabled={pending}
                    onChange={(event) => {
                      const role = event.target.value as MemberRole;
                      startTransition(async () => {
                        await updateMemberRoleAction(businessId, member.userId, role);
                      });
                    }}
                    className="w-36"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await removeMemberAction(businessId, member.userId);
                      })
                    }
                    className="text-hot-600 hover:bg-hot-50 hover:text-hot-700"
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      <dl className="grid gap-3 pt-4 sm:grid-cols-3">
        {ROLES.map((role) => (
          <div key={role}>
            <dt className="text-[13px] font-medium text-ink-800">{ROLE_LABELS[role]}</dt>
            <dd className="mt-0.5 text-[13px] text-ink-500">{ROLE_DESCRIPTIONS[role]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
