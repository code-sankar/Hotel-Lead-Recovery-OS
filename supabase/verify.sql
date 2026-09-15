-- =============================================================================
-- Lead Stay — post-migration verification.
--
--   npm run db:verify      (scripts/db-push.sh verify)
--
-- Asserts the things the application actually depends on, against whatever
-- database SUPABASE_DB_URL points at: the objects exist, RLS is on everywhere,
-- the credential tables are unreachable by `authenticated`, and the RPCs have
-- the shapes the code calls them with. Read-only — it changes nothing.
--
-- Exits non-zero if any check fails, so it can gate a deploy.
-- =============================================================================

\set ON_ERROR_STOP on
\pset footer off

create temporary table _checks (
  seq serial,
  ok boolean not null,
  name text not null,
  detail text not null default ''
);

-- 1. Every table the application reads or writes -----------------------------
with expected(t) as (values
  ('ai_actions'),('alert_channels'),('analytics_events'),('bookings'),
  ('business_invites'),('business_members'),('business_profiles'),
  ('business_settings'),('businesses'),('conversations'),('customers'),
  ('follow_up_rules'),('follow_ups'),('hotel_faqs'),('hotel_policies'),
  ('lead_events'),('leads'),('messages'),('profiles'),('room_availability'),
  ('rooms'),('staff_notes'),('system_events'),('webhook_events'),
  ('whatsapp_integrations'),('whatsapp_templates')
), missing as (
  select t from expected
  except
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
)
insert into _checks (ok, name, detail)
select not exists (select 1 from missing),
       'all 26 tables exist',
       coalesce((select string_agg(t, ', ' order by t) from missing), '');

-- 2. RLS is the tenant boundary, so it must be on for every table ------------
with off as (
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
)
insert into _checks (ok, name, detail)
select not exists (select 1 from off),
       'row level security enabled on every table',
       coalesce((select 'RLS OFF: ' || string_agg(relname, ', ' order by relname) from off), '');

-- 3. The tables with no policies are deliberate, and are exactly these three.
--    A policy appearing on one of them would expose credentials; a policy
--    missing anywhere else would lock the application out of its own data.
with policyless as (
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
), expected(t) as (values ('alert_channels'),('webhook_events'),('whatsapp_integrations'))
insert into _checks (ok, name, detail)
select (select count(*) from (select t from expected except select relname from policyless) x) = 0
   and (select count(*) from (select relname from policyless except select t from expected) y) = 0,
       'only the credential tables have no policies',
       'policy-less: ' || coalesce((select string_agg(relname, ', ' order by relname) from policyless), 'none');

-- 4. Functions the application calls by name --------------------------------
with expected(f) as (values
  ('accept_business_invite'),('create_business_with_owner'),('handle_new_user'),
  ('has_business_role'),('is_business_member'),('preview_business_invite'),
  ('record_system_event'),('seed_default_follow_up_rules'),
  ('seed_default_whatsapp_templates'),('touch_updated_at')
), missing as (
  select f from expected
  except
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
insert into _checks (ok, name, detail)
select not exists (select 1 from missing),
       'all 10 functions exist',
       coalesce((select string_agg(f, ', ' order by f) from missing), '');

-- 5. The RLS helpers must be SECURITY DEFINER or the policies on
--    business_members recurse into themselves.
insert into _checks (ok, name, detail)
select count(*) = 2, 'RLS helpers are SECURITY DEFINER',
       coalesce(string_agg(proname || ':' || prosecdef::text, ' '), 'not found')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and p.proname in ('is_business_member', 'has_business_role');

-- 6. record_system_event decides the alert throttle in SQL, and the caller
--    reads should_alert off the result.
insert into _checks (ok, name, detail)
select coalesce(bool_or(
         proargnames @> array['event_id','occurrences','is_new','should_alert']), false),
       'record_system_event returns should_alert',
       coalesce(string_agg(array_to_string(proargnames, ','), ' | '), 'not found')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'record_system_event';

-- 7. The two non-secret status views ----------------------------------------
with expected(v) as (values ('alert_channel_status'),('whatsapp_integration_status')), missing as (
  select v from expected
  except
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
)
insert into _checks (ok, name, detail)
select not exists (select 1 from missing), 'both status views exist',
       coalesce((select string_agg(v, ', ') from missing), '');

-- 8. Those views read credential tables on the caller's behalf, so they must
--    NOT be security_invoker — otherwise they return nothing to a member.
with invoker as (
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and c.relname in ('alert_channel_status', 'whatsapp_integration_status')
    and array_to_string(coalesce(c.reloptions, '{}'), ',') ilike '%security_invoker=on%'
)
insert into _checks (ok, name, detail)
select not exists (select 1 from invoker), 'status views are security definer',
       coalesce((select 'invoker: ' || string_agg(relname, ', ') from invoker), '');

-- 9. The credential tables themselves stay unreachable ----------------------
--    (has_table_privilege raises on a missing relation, so guard every lookup
--    rather than let one absent table abort the whole report.)
do $$
declare leaks text := ''; missing text := ''; r text; t text;
begin
  foreach t in array array['whatsapp_integrations','alert_channels'] loop
    if to_regclass('public.' || t) is null then
      missing := missing || t || ' ';
      continue;
    end if;
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select, insert, update, delete') then
        leaks := leaks || r || ' -> ' || t || '; ';
      end if;
    end loop;
  end loop;
  insert into _checks (ok, name, detail)
  values (leaks = '' and missing = '',
          'anon/authenticated cannot touch credential tables',
          trim(leaks || case when missing = '' then '' else 'missing: ' || missing end));
end $$;

-- 10. …but the settings pages must be able to read the status views.
do $$
declare denied text := ''; v text;
begin
  foreach v in array array['alert_channel_status','whatsapp_integration_status'] loop
    if to_regclass('public.' || v) is null then
      denied := denied || v || ' (missing) ';
    elsif not has_table_privilege('authenticated', 'public.' || v, 'select') then
      denied := denied || v || ' (no select) ';
    end if;
  end loop;
  insert into _checks (ok, name, detail)
  values (denied = '', 'authenticated can read both status views', trim(denied));
end $$;

-- 11. Signup creates a profile row through this trigger. Without it, every new
--     account lands in the app with no profile.
insert into _checks (ok, name, detail)
select exists (
  select 1 from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created'
), 'on_auth_user_created trigger is installed on auth.users', '';

-- 12. Demo traffic must be distinguishable from delivered WhatsApp messages.
insert into _checks (ok, name, detail)
select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'message_delivery_status' and e.enumlabel = 'simulated'
), 'message_delivery_status includes ''simulated''', '';

-- 13. Later migrations actually landed --------------------------------------
with cols(tbl, col) as (values
  ('rooms','total_units'),                 -- 20250201 room availability
  ('business_invites','token_hash'),       -- 20250301 staff invites
  ('system_events','fingerprint'),         -- 20250301 event log
  ('system_events','last_alerted_at'),     -- 20250301 alerting
  ('alert_channels','webhook_url')
), missing as (
  select tbl || '.' || col as c from cols
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = tbl and column_name = col)
)
insert into _checks (ok, name, detail)
select not exists (select 1 from missing), 'columns from every later migration are present',
       coalesce((select string_agg(c, ', ') from missing), '');

-- 14. Invite tokens are stored hashed. A plaintext column would mean a leaked
--     backup hands out staff access.
insert into _checks (ok, name, detail)
select not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'business_invites' and column_name = 'token'
), 'business_invites stores no plaintext token', '';

-- 15. Every tenant-owned table carries the isolation key. businesses is the
--     tenant itself; profiles belongs to a user, not a hotel.
with offenders as (
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not in ('businesses', 'profiles')
    and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = c.relname and column_name = 'business_id')
)
insert into _checks (ok, name, detail)
select not exists (select 1 from offenders), 'every tenant table carries business_id',
       coalesce((select string_agg(relname, ', ') from offenders), '');

-- 16. History matches the files on disk. The ledger may be absent entirely —
--     that is a failure, not a reason to abort the report.
do $$
declare applied text; n int;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into _checks (ok, name, detail)
    values (false, 'all 7 migrations recorded in the ledger',
            'supabase_migrations.schema_migrations does not exist');
    return;
  end if;
  execute 'select count(*), coalesce(string_agg(version, '' '' order by version), '''')
             from supabase_migrations.schema_migrations' into n, applied;
  insert into _checks (ok, name, detail)
  values (n = 7, 'all 7 migrations recorded in the ledger',
          coalesce(nullif(applied, ''), 'ledger empty'));
end $$;

\echo ''
select case when ok then 'PASS' else 'FAIL' end as result,
       name as check,
       detail
from _checks order by seq;

do $$
declare failed int;
begin
  select count(*) into failed from _checks where not ok;
  if failed > 0 then
    raise exception '% check(s) failed — see the table above', failed;
  end if;
  raise notice 'all % checks passed', (select count(*) from _checks);
end $$;
