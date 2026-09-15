'use client';

import { useActionState, useTransition } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import type { AlertChannelStatus } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { emptyFormState } from '@/lib/forms/state';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { sendTestAlertAction, updateAlertChannelAction } from '@/lib/monitoring/alert-actions';

export function AlertSettings({
  businessId,
  channel,
  timezone,
  operatorAlertingOn,
}: {
  businessId: string;
  channel: AlertChannelStatus | null;
  timezone: string;
  operatorAlertingOn: boolean;
}) {
  const [state, formAction, saving] = useActionState(
    updateAlertChannelAction.bind(null, businessId),
    emptyFormState,
  );
  const [testing, startTest] = useTransition();

  const configured = Boolean(channel?.has_webhook_url);
  const live = configured && (channel?.enabled ?? false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-200 px-4 py-3">
        {live ? (
          <Badge tone="money">Alerts on</Badge>
        ) : configured ? (
          <Badge tone="warm">Configured, switched off</Badge>
        ) : (
          <Badge>No channel</Badge>
        )}
        <span className="text-[13px] text-ink-600">
          {channel?.destination ?? 'Nothing will be pushed; failures appear on this page only.'}
        </span>
        {channel?.last_success_at ? (
          <span className="text-[13px] text-ink-500">
            Last delivered {formatRelative(channel.last_success_at)}
          </span>
        ) : null}
      </div>

      {channel?.last_error ? (
        <p className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
          Last delivery failed: {channel.last_error}
          {channel.last_attempt_at
            ? ` (${formatDateTime(channel.last_attempt_at, timezone)})`
            : ''}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex items-start gap-3 rounded-md border border-ink-200 px-4 py-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={channel?.enabled ?? false}
            className="mt-0.5 size-4 rounded border-ink-300 accent-accent-600"
          />
          <span>
            <span className="block text-[13px] font-medium text-ink-800">
              Push failures to a channel
            </span>
            <span className="mt-0.5 block text-[13px] text-ink-500">
              One message per failure, then at most one an hour while it keeps happening — an outage
              will not flood you.
            </span>
          </span>
        </label>

        <Field
          label="Webhook URL"
          htmlFor="webhookUrl"
          hint={
            configured
              ? 'A URL is stored. Enter a new one to replace it, or leave blank to keep it.'
              : 'A Slack or Discord incoming webhook works as-is. So does any endpoint that accepts a JSON POST.'
          }
          error={state.fieldErrors?.webhookUrl}
        >
          <Input
            id="webhookUrl"
            name="webhookUrl"
            type="url"
            autoComplete="off"
            placeholder={configured ? '••••••••' : 'https://hooks.slack.com/services/...'}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Send alerts for"
            htmlFor="minLevel"
            hint="Warnings include blocked assistant replies."
          >
            <Select id="minLevel" name="minLevel" defaultValue={channel?.min_level ?? 'error'}>
              <option value="error">Errors only</option>
              <option value="warning">Errors and warnings</option>
            </Select>
          </Field>
          <Field
            label="Signing secret (optional)"
            htmlFor="signingSecret"
            hint={
              channel?.has_signing_secret
                ? 'A secret is stored. Slack and Discord ignore it.'
                : 'For a custom receiver that verifies X-LeadStay-Signature.'
            }
          >
            <Input
              id="signingSecret"
              name="signingSecret"
              type="password"
              autoComplete="off"
              placeholder="••••••••"
            />
          </Field>
        </div>

        {configured ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              name="clearWebhook"
              className="size-4 rounded border-ink-300 accent-accent-600"
            />
            Remove the stored webhook and secret
          </label>
        ) : null}

        {state.error ? (
          <p role="alert" className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 pt-4">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save alert settings'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={testing || !configured}
            onClick={() =>
              startTest(async () => {
                const result = await sendTestAlertAction(businessId);
                if (result.ok) toast.success(result.message ?? 'Test alert delivered.');
                else toast.error(result.error ?? 'The test alert could not be delivered.');
              })
            }
          >
            <BellRing className="size-4" />
            {testing ? 'Sending…' : 'Send a test alert'}
          </Button>
          {state.ok && state.message ? (
            <span role="status" className="text-[13px] text-money-700">
              {state.message}
            </span>
          ) : null}
        </div>
      </form>

      <p className="text-[12px] text-ink-500">
        {operatorAlertingOn
          ? 'Failures are also pushed to whoever runs this service, separately from this channel.'
          : 'Nobody outside this hotel is being alerted. Whoever runs this service can set ALERT_WEBHOOK_URL to be told as well.'}
      </p>
    </div>
  );
}
