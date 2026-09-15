import 'server-only';

import { hasServiceRoleKey } from '@/lib/env';
import { createServiceSupabase } from '@/lib/db/service-client';
import { fingerprintOf, messageFrom } from './fingerprint';

/**
 * Operational logging.
 *
 * Two destinations: a structured console line, which reaches whatever log drain
 * the host provides, and a durable row so the failure is visible in the app to
 * someone who was not watching logs at 2am.
 *
 * This must never throw. Monitoring that breaks the thing it monitors is worse
 * than no monitoring, so every failure here is swallowed after a console line.
 */

export type LogLevel = 'error' | 'warning';

export interface LogInput {
  /** Where it happened: 'whatsapp.webhook', 'job.process_inbound_message', … */
  scope: string;
  error?: unknown;
  message?: string;
  /** Persisted only when a tenant is known; otherwise the line is console-only. */
  businessId?: string | null;
  detail?: Record<string, unknown>;
}

export interface BuiltEvent {
  level: LogLevel;
  scope: string;
  message: string;
  fingerprint: string;
  detail: Record<string, unknown>;
  businessId: string | null;
}

/** Pure: turns a log call into the row that would be written. */
export function buildEvent(level: LogLevel, input: LogInput): BuiltEvent {
  const message = input.message ?? messageFrom(input.error);
  const detail: Record<string, unknown> = { ...(input.detail ?? {}) };

  if (input.error instanceof Error) {
    detail.name = input.error.name;
    // A few frames are enough to locate it; the whole stack is noise in a table.
    if (input.error.stack) detail.stack = input.error.stack.split('\n').slice(0, 4).join('\n');
    if (input.message) detail.cause = input.error.message;
  }

  return {
    level,
    scope: input.scope,
    message: message.slice(0, 2000),
    fingerprint: fingerprintOf(input.scope, message),
    detail,
    businessId: input.businessId ?? null,
  };
}

function writeConsoleLine(event: BuiltEvent): void {
  const line = JSON.stringify({
    level: event.level,
    scope: event.scope,
    message: event.message,
    businessId: event.businessId,
    fingerprint: event.fingerprint,
    ...event.detail,
  });
  if (event.level === 'error') console.error(line);
  else console.warn(line);
}

async function persist(event: BuiltEvent): Promise<void> {
  // Without a tenant there is no row that anyone could be shown, and without
  // the service role there is no way to write one.
  if (!event.businessId || !hasServiceRoleKey()) return;

  try {
    const client = createServiceSupabase();
    const { error } = await client.rpc('record_system_event', {
      target_business_id: event.businessId,
      event_level: event.level,
      event_scope: event.scope,
      event_message: event.message,
      event_fingerprint: event.fingerprint,
      event_detail: event.detail,
    });
    if (error) {
      console.error(
        JSON.stringify({ level: 'error', scope: 'monitoring', message: `could not record event: ${error.message}` }),
      );
    }
  } catch (persistError) {
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'monitoring',
        message: `could not record event: ${messageFrom(persistError)}`,
      }),
    );
  }
}

export async function logError(input: LogInput): Promise<void> {
  const event = buildEvent('error', input);
  writeConsoleLine(event);
  await persist(event);
}

export async function logWarning(input: LogInput): Promise<void> {
  const event = buildEvent('warning', input);
  writeConsoleLine(event);
  await persist(event);
}
