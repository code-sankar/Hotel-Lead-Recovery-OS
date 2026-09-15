import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import { hasOperatorAlerting, hasRedis, hasServiceRoleKey } from '@/lib/env';
import type { AlertChannelStatus, SystemEvent } from '@/types/domain';
import { SettingsSection } from '@/components/settings/settings-section';
import { HealthLog } from '@/components/settings/health-log';
import { AlertSettings } from '@/components/settings/alert-settings';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Health' };

export default async function HealthSettingsPage() {
  const { active } = await requireCapability('system_health:view');
  const supabase = await createServerSupabase();

  const [{ data }, { data: channelRow }] = await Promise.all([
    supabase
      .from('system_events')
      .select('*')
      .eq('business_id', active.business.id)
      .order('resolved_at', { ascending: true, nullsFirst: true })
      .order('last_seen_at', { ascending: false })
      .limit(50),
    // The non-secret view: a webhook URL is a credential and never comes back.
    supabase
      .from('alert_channel_status')
      .select('*')
      .eq('business_id', active.business.id)
      .maybeSingle(),
  ]);

  const events = (data ?? []) as SystemEvent[];
  const channel = (channelRow as AlertChannelStatus | null) ?? null;
  const open = events.filter((event) => !event.resolved_at);

  return (
    <>
      <SettingsSection
        title="What has failed"
        description="Errors from incoming messages, replies, follow-ups and background jobs. Repeats are counted rather than repeated."
      >
        {open.length > 0 ? (
          <p className="mb-4 rounded-md bg-hot-50 px-3 py-2.5 text-[13px] text-hot-700">
            {open.length} unresolved {open.length === 1 ? 'issue' : 'issues'}. Anything about
            incoming WhatsApp or follow-ups means enquiries may be going unanswered.
          </p>
        ) : null}
        <HealthLog
          businessId={active.business.id}
          events={events}
          timezone={active.business.timezone}
        />
      </SettingsSection>

      <SettingsSection
        title="Alerts"
        description="Where failures are pushed, so nobody has to remember to check this page."
      >
        <AlertSettings
          businessId={active.business.id}
          channel={channel}
          timezone={active.business.timezone}
          operatorAlertingOn={hasOperatorAlerting()}
        />
      </SettingsSection>

      <SettingsSection title="Setup" description="Whether the parts that run in the background are configured.">
        <dl className="flex flex-col divide-y divide-ink-100">
          <Row
            label="Background worker"
            ok={hasRedis()}
            okText="Redis is configured, so follow-ups run on a worker."
            warnText="No Redis. Jobs run inside the web request, which is fine for testing but not for production — or drive follow-ups from a scheduler hitting /api/cron/follow-ups."
          />
          <Row
            label="Service role key"
            ok={hasServiceRoleKey()}
            okText="Set, so webhooks, the worker and this log can write."
            warnText="Not set. Incoming WhatsApp messages cannot be processed and nothing can be recorded here."
          />
          <Row
            label="Failure alerts"
            ok={Boolean(channel?.enabled && channel.has_webhook_url)}
            okText={`Pushed to ${channel?.destination ?? 'your channel'} when something breaks.`}
            warnText="Nothing is pushed. Failures appear on this page, but only if someone looks."
          />
          <Row
            label="WhatsApp"
            ok={active.business.messaging_mode === 'live'}
            okText="Live — messages go through the Meta Cloud API."
            warnText="Demo mode. Messages are simulated and never reach a guest."
          />
        </dl>
      </SettingsSection>
    </>
  );
}

function Row({
  label,
  ok,
  okText,
  warnText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  warnText: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-[13px] font-medium text-ink-800">{label}</dt>
      <dd className="flex-1 text-right">
        <Badge tone={ok ? 'money' : 'warm'}>{ok ? 'Ready' : 'Attention'}</Badge>
        <p className="mt-1 text-[12px] text-ink-500">{ok ? okText : warnText}</p>
      </dd>
    </div>
  );
}
