'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cancelFollowUpAction } from '@/lib/conversations/actions';

export function CancelFollowUpForm({ followUpId }: { followUpId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set('followUpId', followUpId);
        startTransition(async () => {
          const result = await cancelFollowUpAction(formData);
          if (result.ok) toast.success('Follow-up cancelled.');
          else toast.error(result.error ?? 'That did not work.');
        });
      }}
    >
      {pending ? 'Cancelling…' : 'Cancel'}
    </Button>
  );
}
