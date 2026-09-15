import 'server-only';

import { hasServiceRoleKey, publicEnv, serverEnv } from '@/lib/env';
import { createServiceSupabase } from '@/lib/db/service-client';
import { rateLimit } from '@/lib/security/rate-limit';
import { fingerprintOf, messageFrom } from './fingerprint';
import { buildAlertPayload, deliverAlert, meetsLevel, type AlertContext } from './alerts';

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

interface AlertChannel {
  url: string;
  secret: string | null;
  /** Written back with the delivery outcome; the operator channel has no row. */
  businessId: string | null;
}

/** Every destination this event should reach: the hotel's own, and the operator's. */
async function channelsFor(event: BuiltEvent): Promise<AlertChannel[]> {
  const env = serverEnv();
  const channels: AlertChannel[] = [];

  if (event.businessId && hasServiceRoleKey()) {
    try {
      const { data } = await createServiceSupabase()
        .from('alert_channels')
        .select('webhook_url, signing_secret, min_level, enabled')
        .eq('business_id', event.businessId)
        .maybeSingle();

      const channel = data as
        | { webhook_url: string | null; signing_secret: string | null; min_level: LogLevel; enabled: boolean }
        | null;

      if (channel?.enabled && channel.webhook_url && meetsLevel(event.level, channel.min_level)) {
        channels.push({
          url: channel.webhook_url,
          secret: channel.signing_secret,
          businessId: event.businessId,
        });
      }
    } catch {
      // A missing alert channel must never stop the event being recorded.
    }
  }

  if (env.ALERT_WEBHOOK_URL && meetsLevel(event.level, env.ALERT_MIN_LEVEL)) {
    channels.push({
      url: env.ALERT_WEBHOOK_URL,
      secret: env.ALERT_WEBHOOK_SECRET ?? null,
      businessId: null,
    });
  }

  return channels;
}

async function businessNameFor(businessId: string): Promise<string> {
  try {
    const { data } = await createServiceSupabase()
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .maybeSingle();
    return (data as { name?: string } | null)?.name ?? 'A hotel';
  } catch {
    return 'A hotel';
  }
}

async function dispatchAlerts(
  event: BuiltEvent,
  channels: AlertChannel[],
  occurrences: number,
  isNew: boolean,
): Promise<void> {
  if (!event.businessId || channels.length === 0) return;

  // A storm of DISTINCT failures would slip past the per-fingerprint cooldown,
  // so the process also caps how many alerts it will send per minute.
  if (!rateLimit('alerts:outbound', 10, 60_000).allowed) return;

  let healthUrl: string | undefined;
  try {
    healthUrl = `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/settings/health`;
  } catch {
    healthUrl = undefined;
  }

  const context: AlertContext = {
    level: event.level,
    scope: event.scope,
    message: event.message,
    businessId: event.businessId,
    businessName: await businessNameFor(event.businessId),
    occurrences,
    isNew,
    healthUrl,
    detail: event.detail,
  };

  const payload = buildAlertPayload(context);

  for (const channel of channels) {
    const result = await deliverAlert(channel.url, payload, { secret: channel.secret });

    if (!result.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'alerting',
          message: `alert delivery failed: ${result.error}`,
          businessId: channel.businessId,
        }),
      );
    }

    // Record the outcome so a hotel can see their own channel is broken. Never
    // logged through logError, which would be a loop.
    if (channel.businessId) {
      try {
        await createServiceSupabase()
          .from('alert_channels')
          .update({
            last_attempt_at: new Date().toISOString(),
            ...(result.ok
              ? { last_success_at: new Date().toISOString(), last_error: null }
              : { last_error: result.error ?? 'delivery failed' }),
          })
          .eq('business_id', channel.businessId);
      } catch {
        // Bookkeeping only.
      }
    }
  }
}

async function persist(event: BuiltEvent): Promise<void> {
  // Without a tenant there is no row that anyone could be shown, and without
  // the service role there is no way to write one.
  if (!event.businessId || !hasServiceRoleKey()) return;

  const env = serverEnv();

  // Resolved first: if nothing would accept this event, the cooldown must not
  // be consumed by an alert that was never going to be sent.
  const channels = await channelsFor(event);

  try {
    const client = createServiceSupabase();
    const { data, error } = await client.rpc('record_system_event', {
      target_business_id: event.businessId,
      event_level: event.level,
      event_scope: event.scope,
      event_message: event.message,
      event_fingerprint: event.fingerprint,
      event_detail: event.detail,
      // Timing is decided in SQL, atomically. Severity and destination are
      // decided here, so a level-filtered event never consumes the cooldown.
      alert_eligible: channels.length > 0,
      alert_cooldown_minutes: env.ALERT_COOLDOWN_MINUTES,
    });

    if (error) {
      console.error(
        JSON.stringify({ level: 'error', scope: 'monitoring', message: `could not record event: ${error.message}` }),
      );
      return;
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { occurrences?: number; is_new?: boolean; should_alert?: boolean }
      | null;

    if (row?.should_alert) {
      await dispatchAlerts(event, channels, row.occurrences ?? 1, row.is_new ?? false);
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
