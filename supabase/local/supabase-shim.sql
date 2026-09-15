-- =============================================================================
-- TEST-ONLY stand-in for what Supabase provides.
--
-- Nothing here ships. It exists so the project's real migrations, RLS policies
-- and SECURITY DEFINER functions can be executed against a stock PostgreSQL,
-- and so the PostgREST layer can be exercised over HTTP.
--
-- It mirrors Supabase where that matters:
--   * auth.uid() reads the JWT subject the way Supabase's does
--   * service_role has BYPASSRLS
--   * table privileges come from ALTER DEFAULT PRIVILEGES set BEFORE the
--     migrations run, so a migration's explicit REVOKE is not undone afterwards
-- =============================================================================


do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase derives these from the request JWT; here they come from a GUC the
-- test harness sets, which is behaviourally equivalent for policy evaluation.
-- Supabase exposes the JWT subject this way; PostgREST 9+ sets
-- request.jwt.claims as a JSON string, so read both forms.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'authpass';
  end if;
end $$;
-- Supabase creates service_role with BYPASSRLS; without it the shim would be
-- stricter than production and give false failures.
alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
