'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { acceptInviteAction } from '@/lib/team/actions';

export function AcceptInvite({ token, businessName }: { token: string; businessName: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await acceptInviteAction(token);
          if (!result.ok) {
            toast.error(result.error ?? 'That did not work.');
            return;
          }
          toast.success(result.message ?? 'You have joined the team.');
          router.push('/dashboard');
          router.refresh();
        })
      }
    >
      {pending ? 'Joining…' : `Join ${businessName}`}
    </Button>
  );
}
