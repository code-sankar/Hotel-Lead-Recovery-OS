/**
 * WhatsApp customer service window.
 *
 * Meta only allows free-form replies within 24 hours of the customer's last
 * message. Outside that window an approved template is required. The
 * application must decide this before composing a message, so this is modelled
 * explicitly rather than assumed.
 */

export const SERVICE_WINDOW_HOURS = 24;
const WINDOW_MS = SERVICE_WINDOW_HOURS * 60 * 60 * 1000;

export type OutboundKind = 'free_form' | 'template' | 'blocked';

export interface WindowDecision {
  kind: OutboundKind;
  reason: string;
  /** Milliseconds remaining in the free-form window, when open. */
  remainingMs: number | null;
}

export function decideOutboundKind(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date(),
): WindowDecision {
  if (!lastInboundAt) {
    return {
      kind: 'template',
      reason: 'No inbound message on record, so no service window is open.',
      remainingMs: null,
    };
  }

  const last = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(last.getTime())) {
    return { kind: 'template', reason: 'Unparseable last inbound timestamp.', remainingMs: null };
  }

  const elapsed = now.getTime() - last.getTime();
  if (elapsed < 0) {
    return { kind: 'free_form', reason: 'Service window is open.', remainingMs: WINDOW_MS };
  }
  if (elapsed <= WINDOW_MS) {
    return {
      kind: 'free_form',
      reason: 'Within the 24-hour customer service window.',
      remainingMs: WINDOW_MS - elapsed,
    };
  }
  return {
    kind: 'template',
    reason: 'The 24-hour customer service window has closed; a template is required.',
    remainingMs: null,
  };
}

export function isServiceWindowOpen(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return decideOutboundKind(lastInboundAt, now).kind === 'free_form';
}
