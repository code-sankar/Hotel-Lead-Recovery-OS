-- =============================================================================
-- Helper functions, triggers and tenant-scoped RPCs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so RLS policies on business_members do
-- not recurse when a policy asks "is the caller a member of this business?".
-- ---------------------------------------------------------------------------
create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from business_members m
    where m.business_id = target_business_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from business_members m
    where m.business_id = target_business_id
      and m.user_id = auth.uid()
      and m.role = any (allowed_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'businesses', 'business_members', 'business_profiles', 'rooms',
    'hotel_policies', 'hotel_faqs', 'business_settings', 'whatsapp_integrations',
    'whatsapp_templates', 'customers', 'conversations', 'leads',
    'follow_up_rules', 'follow_ups'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile provisioning on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Business provisioning.
--
-- Creating a hotel touches four tables and must leave the creator as owner.
-- Doing it in one SECURITY DEFINER call keeps it atomic and avoids a
-- chicken-and-egg RLS problem (you cannot be a member of a business that does
-- not exist yet).
-- ---------------------------------------------------------------------------
create or replace function public.create_business_with_owner(
  business_name text,
  business_timezone text default 'Asia/Kolkata',
  business_currency text default 'INR'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_business_id uuid;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'authentication required';
  end if;

  if business_name is null or length(btrim(business_name)) = 0 then
    raise exception 'business name is required';
  end if;

  insert into businesses (name, timezone, currency, created_by)
  values (btrim(business_name), coalesce(business_timezone, 'Asia/Kolkata'), coalesce(business_currency, 'INR'), caller)
  returning id into new_business_id;

  insert into business_members (business_id, user_id, role)
  values (new_business_id, caller, 'owner');

  insert into business_profiles (business_id) values (new_business_id);
  insert into business_settings (business_id) values (new_business_id);
  insert into whatsapp_integrations (business_id) values (new_business_id);

  perform public.seed_default_follow_up_rules(new_business_id);
  perform public.seed_default_whatsapp_templates(new_business_id);

  return new_business_id;
end;
$$;

create or replace function public.seed_default_follow_up_rules(target_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into follow_up_rules
    (business_id, name, trigger, delay_minutes, sequence_index, conditions, message_template, whatsapp_template_purpose)
  values
    (
      target_business_id,
      'First follow-up — no reply',
      'customer_inactive',
      1440,
      1,
      '{"lead_status_not_in": ["converted", "lost", "paused"], "conversation_mode": "ai"}'::jsonb,
      'Hi {{customer_name}}, just checking whether you had a chance to look at the room options. Happy to help with the booking whenever you are ready.',
      'follow_up_1'
    ),
    (
      target_business_id,
      'Second follow-up — still quiet',
      'previous_follow_up_sent',
      2880,
      2,
      '{"lead_status_not_in": ["converted", "lost", "paused"], "conversation_mode": "ai"}'::jsonb,
      'We are happy to help with your stay whenever you are ready. Would you like me to keep your enquiry open?',
      'follow_up_2'
    )
  on conflict (business_id, sequence_index) do nothing;
end;
$$;

create or replace function public.seed_default_whatsapp_templates(target_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Template IDENTIFIERS only. The templates themselves must be created and
  -- approved in the hotel's WhatsApp Business account before live follow-ups
  -- (which land outside the 24-hour window) can be delivered.
  insert into whatsapp_templates (business_id, purpose, template_name, language_code, body_preview)
  values
    (target_business_id, 'follow_up_1', 'leadstay_follow_up_1', 'en',
     'Hi {{1}}, just checking whether you had a chance to look at the room options at {{2}}.'),
    (target_business_id, 'follow_up_2', 'leadstay_follow_up_2', 'en',
     'Hi {{1}}, we are happy to help with your stay at {{2}} whenever you are ready.'),
    (target_business_id, 'reengagement', 'leadstay_reengagement', 'en',
     'Hi {{1}}, this is {{2}}. We have an update on your enquiry.')
  on conflict (business_id, purpose) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Non-secret WhatsApp connection status.
--
-- whatsapp_integrations holds access tokens and app secrets, so the table is
-- fully denied to the `authenticated` role (see RLS migration). This view runs
-- with definer rights and applies its own membership filter, exposing only the
-- columns that are safe to render in settings.
-- ---------------------------------------------------------------------------
create view public.whatsapp_integration_status
with (security_barrier = true) as
  select
    i.business_id,
    i.display_phone_number,
    i.status,
    i.last_error,
    i.last_verified_at,
    i.phone_number_id is not null as has_phone_number_id,
    i.waba_id is not null as has_waba_id,
    i.access_token is not null as has_access_token,
    i.app_secret is not null as has_app_secret,
    i.verify_token is not null as has_verify_token,
    i.updated_at
  from whatsapp_integrations i
  where public.is_business_member(i.business_id);

alter view public.whatsapp_integration_status set (security_invoker = off);

revoke all on public.whatsapp_integrations from anon, authenticated;
grant select on public.whatsapp_integration_status to authenticated;
