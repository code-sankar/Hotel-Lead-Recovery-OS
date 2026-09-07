'use client';

import { useTransition } from 'react';
import { Bot, CheckCircle2, Hand, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { ConversationMode } from '@/types/domain';
import { Button } from '@/components/ui/button';
import {
  markConversationResolvedAction,
  setConversationModeAction,
} from '@/lib/conversations/actions';

export function ConversationActions({
  conversationId,
  mode,
  resolved,
}: {
  conversationId: string;
  mode: ConversationMode;
  resolved: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function setMode(next: ConversationMode, successMessage: string) {
    const formData = new FormData();
    formData.set('conversationId', conversationId);
    formData.set('mode', next);
    startTransition(async () => {
      const result = await setConversationModeAction(formData);
      if (result.ok) toast.success(successMessage);
      else toast.error(result.error ?? 'That did not work.');
    });
  }

  function resolve() {
    const formData = new FormData();
    formData.set('conversationId', conversationId);
    startTransition(async () => {
      const result = await markConversationResolvedAction(formData);
      if (result.ok) toast.success('Conversation resolved.');
      else toast.error(result.error ?? 'That did not work.');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mode !== 'human' ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setMode('human', 'You have taken over. The assistant will not reply.')}
        >
          <Hand className="size-3.5" />
          Take over
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => setMode('ai', 'The assistant is handling this conversation again.')}
        >
          <Bot className="size-3.5" />
          Return to assistant
        </Button>
      )}

      {mode === 'paused' ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setMode('ai', 'Assistant resumed.')}
        >
          <Play className="size-3.5" />
          Resume assistant
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setMode('paused', 'Assistant paused for this conversation.')}
        >
          <Pause className="size-3.5" />
          Pause assistant
        </Button>
      )}

      {!resolved ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={resolve}>
          <CheckCircle2 className="size-3.5" />
          Mark resolved
        </Button>
      ) : null}
    </div>
  );
}
