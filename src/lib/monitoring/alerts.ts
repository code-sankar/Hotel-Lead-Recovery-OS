import { createHmac } from 'node:crypto';
import type { SystemEventLevel } from '@/types/domain';

/**
 * Alert payloads and delivery.
 *
 * Deliberately a plain outbound webhook rather than an integration with any one
 * service. A Slack or Discord incoming webhook works with no configuration, and
 * so does anything else that accepts a JSON POST — n8n, Zapier, a Lambda, a
 * pager. Nothing here needs an account anywhere.
 *
 * WhatsApp is pointedly NOT the channel: the thing most likely to be broken is
 * WhatsApp, and an alert that travels over the failure cannot report it.
 */

export interface AlertContext {
  level: SystemEventLevel;
  scope: string;
  message: string;
  businessName: string;
  businessId: string;
  occurrences: number;
  isNew: boolean;
  /** Link to the health page, so the reader can act rather than just worry. */
  healthUrl?: string;
  detail?: Record<string, unknown>;
}

export interface AlertPayload {
  /** Slack renders `text`; Discord renders `content`. Both are sent so that a
   *  webhook URL can be pasted in from either without a format setting. */
  text: string;
  content: string;
  level: SystemEventLevel;
  scope: string;
  message: string;
  business: { id: string; name: string };
  occurrences: number;
  isNew: boolean;
  url?: string;
  detail?: Record<string, unknown>;
  source: 'lead-stay';
  sentAt: string;
}

/** Plain-language names, so an alert reads as a sentence rather than a log key. */
const SCOPE_LABELS: Record<string, string> = {
  'whatsapp.webhook': 'Incoming WhatsApp',
  'messaging.outbound': 'Sending a message',
  'followup.send': 'Sending a follow-up',
  'ai.guardrail': 'Assistant reply blocked',
  'job.process_inbound_message': 'Processing an enquiry',
  'job.execute_follow_up': 'Running a follow-up',
  'job.sweep_follow_ups': 'Follow-up sweep',
  'alerting.test': 'Test alert',
};

export function describeScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

export function buildAlertPayload(context: AlertContext, now: Date = new Date()): AlertPayload {
  const icon = context.level === 'error' ? '🔴' : '🟠';
  const repeated =
    context.occurrences > 1 ? ` (${context.occurrences} times, still happening)` : '';

  const lines = [
    `${icon} *${context.businessName}* — ${describeScope(context.scope)}${repeated}`,
    context.message,
  ];
  if (context.healthUrl) lines.push(context.healthUrl);

  const text = lines.join('\n');

  return {
    text,
    content: text,
    level: context.level,
    scope: context.scope,
    message: context.message,
    business: { id: context.businessId, name: context.businessName },
    occurrences: context.occurrences,
    isNew: context.isNew,
    url: context.healthUrl,
    detail: context.detail,
    source: 'lead-stay',
    sentAt: now.toISOString(),
  };
}

/** Warnings are noisier than errors, so a channel set to `error` skips them. */
export function meetsLevel(level: SystemEventLevel, minimum: SystemEventLevel): boolean {
  if (minimum === 'warning') return true;
  return level === 'error';
}

export function signAlertBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Alerts are best-effort: the durable row is the source of truth, not this. */
const DELIVERY_TIMEOUT_MS = 5000;

export async function deliverAlert(
  url: string,
  payload: AlertPayload,
  options: { secret?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.secret) headers['x-leadstay-signature'] = signAlertBody(body, options.secret);

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: `Endpoint returned HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: /abort|timeout/i.test(message) ? 'The endpoint did not respond within 5 seconds.' : message,
    };
  }
}
