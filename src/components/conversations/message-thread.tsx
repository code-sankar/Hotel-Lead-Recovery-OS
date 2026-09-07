import { Bot, User, Wrench } from 'lucide-react';
import type { Message } from '@/types/domain';
import { cn } from '@/lib/utils/cn';
import { formatTime } from '@/lib/utils/format';

/**
 * The conversation thread. Who wrote each message matters here, so customer,
 * assistant, staff and system messages are visually distinct — and a demo-mode
 * send is labelled rather than shown as delivered.
 */
export function MessageThread({
  messages,
  timezone,
  customerName,
}: {
  messages: Message[];
  timezone: string;
  customerName: string;
}) {
  if (messages.length === 0) {
    return (
      <p className="px-6 py-12 text-center text-[13px] text-ink-500">
        No messages in this conversation yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3 px-6 py-5">
      {messages.map((message) => {
        const inbound = message.direction === 'inbound';
        const isStaff = message.sender_type === 'staff';
        const isSystem = message.sender_type === 'system';

        if (isSystem) {
          return (
            <li key={message.id} className="self-center">
              <p className="rounded-full bg-ink-100 px-3 py-1 text-[12px] text-ink-500">
                {message.text}
              </p>
            </li>
          );
        }

        return (
          <li
            key={message.id}
            className={cn('flex max-w-[min(34rem,80%)] flex-col gap-1', inbound ? 'self-start' : 'self-end')}
          >
            <div
              className={cn(
                'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                inbound
                  ? 'rounded-bl-sm bg-white text-ink-800 shadow-[0_1px_2px_rgba(16,24,40,0.06)]'
                  : isStaff
                    ? 'rounded-br-sm bg-accent-600 text-white'
                    : 'rounded-br-sm bg-ink-800 text-ink-50',
              )}
            >
              {message.message_type !== 'text' && !message.text ? (
                <span className="italic opacity-80">[{message.message_type} message]</span>
              ) : (
                <span className="whitespace-pre-wrap">{message.text}</span>
              )}
            </div>

            <div
              className={cn(
                'flex items-center gap-1.5 px-1 text-[11px] text-ink-400',
                inbound ? 'justify-start' : 'justify-end',
              )}
            >
              {inbound ? (
                <>
                  <User className="size-3" />
                  <span>{customerName}</span>
                </>
              ) : isStaff ? (
                <>
                  <Wrench className="size-3" />
                  <span>Staff</span>
                </>
              ) : (
                <>
                  <Bot className="size-3" />
                  <span>Assistant{message.ai_model ? ` · ${message.ai_model}` : ''}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <time dateTime={message.created_at}>{formatTime(message.created_at, timezone)}</time>
              {message.delivery_status === 'simulated' ? (
                <span className="rounded bg-warm-50 px-1 py-px text-[10px] font-medium text-warm-700">
                  demo · not sent
                </span>
              ) : null}
              {message.delivery_status === 'failed' ? (
                <span className="rounded bg-hot-50 px-1 py-px text-[10px] font-medium text-hot-700">
                  failed
                </span>
              ) : null}
              {message.message_type === 'template' ? (
                <span className="rounded bg-ink-100 px-1 py-px text-[10px] text-ink-600">template</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
