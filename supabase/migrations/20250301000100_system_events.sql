-- =============================================================================
-- Operational event log.
--
-- Nothing was instrumented, so a webhook failing at 2am was invisible: the
-- error went to a console nobody was reading. This gives failures somewhere
-- durable to land and a page to read them on.
--
-- Events are deduplicated by fingerprint and counted, so a provider outage that
-- fails two thousand times is one row saying "2000", not two thousand rows.
-- =============================================================================

create type system_event_level as enum ('error', 'warning');

create table system_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  level system_event_level not null default 'error',
  -- Where it happened: 'whatsapp.webhook', 'job.process_inbound_message', …
  scope text not null,
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  -- Stable hash of scope + message, so repeats collapse onto one row.
  fingerprint text not null,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  unique (business_id, fingerprint)
);

create index system_events_open_idx on system_events (business_id, last_seen_at desc)
  where resolved_at is null;

alter table system_events enable row level security;

-- Members read their own hotel's failures; owners and managers clear them.
-- Writes come from the service role through the RPC below.
create policy system_events_select_member on system_events
  for select to authenticated
  using (public.is_business_member(business_id));

create policy system_events_resolve_manager on system_events
  for update to authenticated
  using (public.has_business_role(business_id, array['owner', 'manager']::member_role[]))
  with check (public.has_business_role(business_id, array['owner', 'manager']::member_role[]));

-- ---------------------------------------------------------------------------
-- Upsert-and-count. SECURITY DEFINER so a worker running without a user session
-- can still record, and so recording can never be blocked by RLS — monitoring
-- must not be the thing that fails silently.
-- ---------------------------------------------------------------------------
create or replace function public.record_system_event(
  target_business_id uuid,
  event_level system_event_level,
  event_scope text,
  event_message text,
  event_fingerprint text,
  event_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  insert into system_events (
    business_id, level, scope, message, fingerprint, detail
  )
  values (
    target_business_id, event_level, event_scope, left(event_message, 2000),
    event_fingerprint, coalesce(event_detail, '{}'::jsonb)
  )
  on conflict (business_id, fingerprint) do update
    set occurrences  = system_events.occurrences + 1,
        last_seen_at = now(),
        message      = excluded.message,
        detail       = excluded.detail,
        level        = excluded.level,
        -- A recurrence reopens something previously marked resolved.
        resolved_at  = null,
        resolved_by  = null
  returning id into event_id;

  return event_id;
end;
$$;
