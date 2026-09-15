-- =============================================================================
-- Failure alerting.
--
-- The event log made failures visible to someone who went looking. This pushes
-- them out so nobody has to.
--
-- The hard part is not delivery, it is not sending two thousand messages for
-- one outage. The decision is made HERE, inside the same statement that records
-- the occurrence, so two workers hitting the same failure at the same moment
-- cannot both decide to alert.
--
-- Rule: alert on the first occurrence of a fingerprint, then at most once per
-- cooldown window while it keeps happening.
-- =============================================================================

alter table system_events
  add column last_alerted_at timestamptz,
  add column alerts_sent integer not null default 0;

comment on column system_events.last_alerted_at is
  'When an alert was last pushed for this fingerprint. Drives the cooldown.';

-- ---------------------------------------------------------------------------
-- Alert destinations.
--
-- A Slack or Discord webhook URL is a credential: anyone holding it can post as
-- the integration. So this table is treated exactly like whatsapp_integrations
-- — no policies at all for `authenticated`, and settings reads a non-secret
-- view instead.
-- ---------------------------------------------------------------------------
create table alert_channels (
  business_id uuid primary key references businesses (id) on delete cascade,
  webhook_url text,
  -- Optional. When set, deliveries carry an HMAC-SHA256 signature header so a
  -- custom receiver can verify them.
  signing_secret text,
  min_level system_event_level not null default 'error',
  enabled boolean not null default true,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger alert_channels_touch_updated_at
  before update on public.alert_channels
  for each row execute function public.touch_updated_at();

alter table alert_channels enable row level security;
revoke all on public.alert_channels from anon, authenticated;

create view public.alert_channel_status
with (security_barrier = true) as
  select
    c.business_id,
    c.enabled,
    c.min_level,
    c.webhook_url is not null as has_webhook_url,
    c.signing_secret is not null as has_signing_secret,
    -- Enough to recognise which destination is configured, without handing
    -- back a URL that can be posted to.
    case
      when c.webhook_url is null then null
      when c.webhook_url like '%hooks.slack.com%' then 'Slack'
      when c.webhook_url like '%discord.com%' or c.webhook_url like '%discordapp.com%' then 'Discord'
      else 'Custom endpoint'
    end as destination,
    c.last_attempt_at,
    c.last_success_at,
    c.last_error,
    c.updated_at
  from alert_channels c
  where public.is_business_member(c.business_id);

alter view public.alert_channel_status set (security_invoker = off);
grant select on public.alert_channel_status to authenticated;

-- ---------------------------------------------------------------------------
-- Record an occurrence and decide, atomically, whether it warrants an alert.
--
-- `alert_eligible` is the caller's judgement on severity — it already knows the
-- channel's minimum level. This function only decides on TIMING, and stamps
-- last_alerted_at in the same statement so the decision cannot be duplicated.
-- ---------------------------------------------------------------------------
drop function if exists public.record_system_event(uuid, system_event_level, text, text, text, jsonb);

create or replace function public.record_system_event(
  target_business_id uuid,
  event_level system_event_level,
  event_scope text,
  event_message text,
  event_fingerprint text,
  event_detail jsonb default '{}'::jsonb,
  alert_eligible boolean default false,
  alert_cooldown_minutes integer default 60
)
returns table (
  event_id uuid,
  occurrences integer,
  is_new boolean,
  should_alert boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  previous_alert timestamptz;
  new_row boolean;
  alerting boolean;
begin
  select e.id, e.last_alerted_at
    into existing_id, previous_alert
    from system_events e
   where e.business_id = target_business_id
     and e.fingerprint = event_fingerprint;

  new_row := existing_id is null;

  alerting := alert_eligible and (
    new_row
    or previous_alert is null
    or previous_alert < now() - make_interval(mins => greatest(alert_cooldown_minutes, 0))
  );

  insert into system_events (
    business_id, level, scope, message, fingerprint, detail,
    last_alerted_at, alerts_sent
  )
  values (
    target_business_id, event_level, event_scope, left(event_message, 2000),
    event_fingerprint, coalesce(event_detail, '{}'::jsonb),
    case when alerting then now() else null end,
    case when alerting then 1 else 0 end
  )
  on conflict (business_id, fingerprint) do update
    set occurrences     = system_events.occurrences + 1,
        last_seen_at    = now(),
        message         = excluded.message,
        detail          = excluded.detail,
        level           = excluded.level,
        -- A recurrence reopens something previously marked resolved.
        resolved_at     = null,
        resolved_by     = null,
        last_alerted_at = case when alerting then now() else system_events.last_alerted_at end,
        alerts_sent     = system_events.alerts_sent + case when alerting then 1 else 0 end
  returning system_events.id, system_events.occurrences
    into event_id, occurrences;

  is_new := new_row;
  should_alert := alerting;
  return next;
end;
$$;
