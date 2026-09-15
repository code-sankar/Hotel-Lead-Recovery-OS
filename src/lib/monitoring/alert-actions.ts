'use server';

import { revalidatePath } from 'next/cache';
import { assertCapabilityFor } from '@/lib/auth/session';
import { createServiceSupabase } from '@/lib/db/service-client';
import { publicEnv } from '@/lib/env';
import type { FormState } from '@/lib/forms/state';
import { alertChannelSchema } from '@/lib/validation/schemas';
import { buildAlertPayload, deliverAlert } from './alerts';

/**
 * Alert channel configuration.
 *
 * A Slack or Discord webhook URL is a credential — anyone holding it can post
 * as the integration — so it is written with the service role after an explicit
 * capability check and is never read back into the browser, exactly like the
 * WhatsApp access token.
 */

function checkbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === 'on' || value === 'true';
}

export async function updateAlertChannelAction(
  businessId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await assertCapabilityFor(businessId, 'system_health:view');

    const parsed = alertChannelSchema.safeParse({
      enabled: checkbox(formData, 'enabled'),
      webhookUrl: formData.get('webhookUrl') ?? '',
      signingSecret: formData.get('signingSecret') ?? '',
      minLevel: formData.get('minLevel'),
      clearWebhook: checkbox(formData, 'clearWebhook'),
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, fieldErrors };
    }

    let client;
    try {
      client = createServiceSupabase();
    } catch {
      return {
        ok: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured, so the webhook URL cannot be stored.',
      };
    }

    const { data: existing } = await client
      .from('alert_channels')
      .select('webhook_url, signing_secret')
      .eq('business_id', businessId)
      .maybeSingle();

    const stored = existing as { webhook_url: string | null; signing_secret: string | null } | null;

    const webhookUrl = parsed.data.clearWebhook
      ? null
      : parsed.data.webhookUrl || stored?.webhook_url || null;

    if (parsed.data.enabled && !webhookUrl) {
      return { ok: false, error: 'Add a webhook URL before switching alerts on.' };
    }

    const { error } = await client.from('alert_channels').upsert(
      {
        business_id: businessId,
        enabled: parsed.data.enabled,
        min_level: parsed.data.minLevel,
        webhook_url: webhookUrl,
        signing_secret: parsed.data.clearWebhook
          ? null
          : parsed.data.signingSecret || stored?.signing_secret || null,
      },
      { onConflict: 'business_id' },
    );
    if (error) return { ok: false, error: error.message };

    revalidatePath('/settings/health');
    return {
      ok: true,
      message: parsed.data.clearWebhook
        ? 'Webhook removed. No alerts will be sent.'
        : parsed.data.enabled
          ? 'Alerts are on. Send a test to confirm the endpoint accepts them.'
          : 'Saved. Alerts are switched off.',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Sends a real alert through the configured channel. An alert path nobody has
 * exercised is not a safety net, so this posts the same payload shape a genuine
 * failure would, and reports exactly what the endpoint said.
 */
export async function sendTestAlertAction(
  businessId: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const context = await assertCapabilityFor(businessId, 'system_health:view');

    let client;
    try {
      client = createServiceSupabase();
    } catch {
      return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' };
    }

    const { data } = await client
      .from('alert_channels')
      .select('webhook_url, signing_secret, enabled')
      .eq('business_id', businessId)
      .maybeSingle();

    const channel = data as
      | { webhook_url: string | null; signing_secret: string | null; enabled: boolean }
      | null;

    if (!channel?.webhook_url) {
      return { ok: false, error: 'Add a webhook URL and save before sending a test.' };
    }

    let healthUrl: string | undefined;
    try {
      healthUrl = `${publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}/settings/health`;
    } catch {
      healthUrl = undefined;
    }

    const result = await deliverAlert(
      channel.webhook_url,
      buildAlertPayload({
        level: 'warning',
        scope: 'alerting.test',
        message: 'This is a test alert from Lead Stay. Nothing is wrong.',
        businessId,
        businessName: context.active.business.name,
        occurrences: 1,
        isNew: true,
        healthUrl,
      }),
      { secret: channel.signing_secret },
    );

    await client
      .from('alert_channels')
      .update({
        last_attempt_at: new Date().toISOString(),
        ...(result.ok
          ? { last_success_at: new Date().toISOString(), last_error: null }
          : { last_error: result.error ?? 'delivery failed' }),
      })
      .eq('business_id', businessId);

    revalidatePath('/settings/health');

    if (!result.ok) return { ok: false, error: result.error ?? 'The endpoint rejected the alert.' };
    return {
      ok: true,
      message: channel.enabled
        ? 'Test alert delivered. Check the channel.'
        : 'Test alert delivered, but alerts are switched off, so real failures will not be sent.',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
