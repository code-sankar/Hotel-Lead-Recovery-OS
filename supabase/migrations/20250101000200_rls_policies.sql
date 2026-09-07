-- =============================================================================
-- Row Level Security.
--
-- Tenant isolation is enforced in the database, not in the application layer.
-- Every business-owned table is readable only by members of that business.
-- Write access is narrowed by role:
--   owner   — hotel configuration, staff, WhatsApp, everything below
--   manager — conversations, leads, follow-ups, follow-up rules, notes
--   staff   — conversations, leads, manual follow-ups, customers, notes
-- The service role (webhooks, workers) bypasses RLS and must scope every query
-- by business_id itself; see src/lib/db/supabase-store.ts.
-- =============================================================================

alter table profiles                enable row level security;
alter table businesses              enable row level security;
alter table business_members        enable row level security;
alter table business_profiles       enable row level security;
alter table rooms                   enable row level security;
alter table hotel_policies          enable row level security;
alter table hotel_faqs              enable row level security;
alter table business_settings       enable row level security;
alter table whatsapp_integrations   enable row level security;
alter table whatsapp_templates      enable row level security;
alter table customers               enable row level security;
alter table conversations           enable row level security;
alter table messages                enable row level security;
alter table leads                   enable row level security;
alter table lead_events             enable row level security;
alter table staff_notes             enable row level security;
alter table follow_up_rules         enable row level security;
alter table follow_ups              enable row level security;
alter table ai_actions              enable row level security;
alter table analytics_events        enable row level security;
alter table webhook_events          enable row level security;

-- ---------------------------------------------------------------------------
-- profiles — a user sees their own profile plus teammates' profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from business_members mine
      join business_members theirs on theirs.business_id = mine.business_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
create policy businesses_select_member on businesses
  for select to authenticated
  using (public.is_business_member(id));

create policy businesses_update_owner on businesses
  for update to authenticated
  using (public.has_business_role(id, array['owner']::member_role[]))
  with check (public.has_business_role(id, array['owner']::member_role[]));

-- Inserts go through public.create_business_with_owner() so the creator is
-- always registered as owner in the same transaction.

-- ---------------------------------------------------------------------------
-- business_members
-- ---------------------------------------------------------------------------
create policy business_members_select on business_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_business_member(business_id));

create policy business_members_write_owner on business_members
  for all to authenticated
  using (public.has_business_role(business_id, array['owner']::member_role[]))
  with check (public.has_business_role(business_id, array['owner']::member_role[]));

-- ---------------------------------------------------------------------------
-- Hotel configuration: every member reads, owners write.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'business_profiles', 'rooms', 'hotel_policies', 'hotel_faqs',
    'business_settings', 'whatsapp_templates'
  ]
  loop
    execute format(
      'create policy %1$s_select_member on public.%1$I
         for select to authenticated using (public.is_business_member(business_id))', t
    );
    execute format(
      'create policy %1$s_write_owner on public.%1$I
         for all to authenticated
         using (public.has_business_role(business_id, array[''owner'']::member_role[]))
         with check (public.has_business_role(business_id, array[''owner'']::member_role[]))', t
    );
  end loop;
end;
$$;

-- whatsapp_integrations holds secrets: no policies at all for `authenticated`,
-- so every client read/write is denied. Settings UI reads the
-- whatsapp_integration_status view; writes go through a server action using the
-- service role after an explicit owner check.

-- ---------------------------------------------------------------------------
-- Operational data: every member of the tenant may read and write.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'conversations', 'messages', 'leads', 'lead_events',
    'staff_notes', 'follow_ups'
  ]
  loop
    execute format(
      'create policy %1$s_select_member on public.%1$I
         for select to authenticated using (public.is_business_member(business_id))', t
    );
    execute format(
      'create policy %1$s_write_member on public.%1$I
         for all to authenticated
         using (public.is_business_member(business_id))
         with check (public.is_business_member(business_id))', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-up rules: owners and managers configure automation.
-- ---------------------------------------------------------------------------
create policy follow_up_rules_select_member on follow_up_rules
  for select to authenticated
  using (public.is_business_member(business_id));

create policy follow_up_rules_write_manager on follow_up_rules
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'manager']::member_role[]))
  with check (public.has_business_role(business_id, array['owner', 'manager']::member_role[]));

-- ---------------------------------------------------------------------------
-- Telemetry: readable by members, written only by the service role.
-- ---------------------------------------------------------------------------
create policy ai_actions_select_member on ai_actions
  for select to authenticated
  using (public.is_business_member(business_id));

create policy analytics_events_select_member on analytics_events
  for select to authenticated
  using (public.is_business_member(business_id));

-- webhook_events has no authenticated policies: raw provider payloads stay
-- server-side only.
