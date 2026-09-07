'use client';

import { useRef, useState, useTransition } from 'react';
import { SendHorizonal } from 'lucide-react';
import { toast } from 'sonner';
import type { ConversationMode } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { sendStaffMessageAction } from '@/lib/conversations/actions';

export function Composer({
  conversationId,
  mode,
  optedOut,
  windowOpen,
}: {
  conversationId: string;
  mode: ConversationMode;
  optedOut: boolean;
  windowOpen: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await sendStaffMessageAction(formData);
      if (!result.ok) {
        toast.error(result.error ?? 'The message could not be sent.');
        return;
      }
      setText('');
      formRef.current?.reset();
      if (result.message) toast.info(result.message);
    });
  }

  return (
    <form ref={formRef} action={submit} className="border-t border-ink-200 bg-white px-4 py-3">
      <input type="hidden" name="conversationId" value={conversationId} />

      {mode === 'ai' ? (
        <p className="mb-2 text-[12px] text-ink-500">
          The assistant is handling this conversation. Sending a message does not pause it — use
          “Take over” to stop automatic replies.
        </p>
      ) : null}
      {optedOut ? (
        <p className="mb-2 rounded-md bg-warm-50 px-2.5 py-1.5 text-[12px] text-warm-700">
          This guest asked not to be messaged. Only reply if they have written to you again.
        </p>
      ) : null}
      {!windowOpen ? (
        <p className="mb-2 rounded-md bg-ink-100 px-2.5 py-1.5 text-[12px] text-ink-600">
          More than 24 hours since the guest’s last message, so WhatsApp requires an approved
          template. This message will be sent using your re-engagement template.
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <textarea
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          rows={2}
          required
          maxLength={4000}
          placeholder="Write a reply…  (⌘/Ctrl + Enter to send)"
          className="min-h-[2.75rem] flex-1 resize-y rounded-md border border-ink-200 px-3 py-2 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
        />
        <Button type="submit" disabled={pending || text.trim().length === 0}>
          <SendHorizonal className="size-4" />
          {pending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
