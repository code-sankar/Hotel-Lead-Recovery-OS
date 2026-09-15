-- =============================================================================
-- Staff invitations.
--
-- Adding a colleague previously meant inserting a business_members row by hand
-- in Supabase, which is fine for a developer and impossible for a hotel.
--
-- An owner creates an invite and gets a link. How the link travels is their
-- choice — for a WhatsApp-first product that is usually WhatsApp, not email,
-- so nothing here depends on an SMTP provider being configured.
--
-- The token is never stored. The database holds only a SHA-256 hash of it,
-- computed by the application, so a leaked database row cannot be redeemed and
-- the plaintext never reaches Postgres logs.
-- =============================================================================

create table business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  email text not null,
  role member_role not null default 'staff',
  -- SHA-256 of the invite token, hex encoded. Unique so a token identifies
  -- exactly one invite.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_invites_business_idx on business_invites (business_id, created_at desc);
-- One live invite per email per hotel; re-inviting revokes and re-issues.
create unique index business_invites_pending_idx
  on business_invites (business_id, lower(email))
  where accepted_at is null and revoked_at is null;

create trigger business_invites_touch_updated_at
  before update on public.business_invites
  for each row execute function public.touch_updated_at();

alter table business_invites enable row level security;

-- Only owners see or manage invitations. The invitee is not a member yet, so
-- they reach their invite through the SECURITY DEFINER functions below.
create policy business_invites_manage_owner on business_invites
  for all to authenticated
  using (public.has_business_role(business_id, array['owner']::member_role[]))
  with check (public.has_business_role(business_id, array['owner']::member_role[]));

-- ---------------------------------------------------------------------------
-- Preview: what an invite link points at, before the recipient has an account.
-- Returns nothing identifying beyond the hotel name and the invited address.
-- ---------------------------------------------------------------------------
create or replace function public.preview_business_invite(invite_token_hash text)
returns table (
  business_name text,
  email text,
  role member_role,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    b.name,
    i.email,
    i.role,
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end
  from business_invites i
  join businesses b on b.id = i.business_id
  where i.token_hash = invite_token_hash;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accept. Runs as definer because the caller is, by definition, not yet a
-- member of the business they are joining.
-- ---------------------------------------------------------------------------
create or replace function public.accept_business_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite business_invites%rowtype;
  caller uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select email into caller_email from auth.users where id = caller;

  select * into invite from business_invites where token_hash = invite_token_hash;

  if not found then
    raise exception 'This invitation link is not valid.' using errcode = 'P0002';
  end if;
  if invite.revoked_at is not null then
    raise exception 'This invitation has been revoked.' using errcode = 'P0001';
  end if;
  if invite.accepted_at is not null then
    raise exception 'This invitation has already been used.' using errcode = 'P0001';
  end if;
  if invite.expires_at <= now() then
    raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'P0001';
  end if;

  -- The invite names an address; redeeming it from another account would let a
  -- forwarded link hand access to a stranger.
  if lower(coalesce(caller_email, '')) <> lower(invite.email) then
    raise exception 'This invitation was sent to %. Sign in with that email to accept it.', invite.email
      using errcode = 'P0001';
  end if;

  insert into business_members (business_id, user_id, role)
  values (invite.business_id, caller, invite.role)
  on conflict (business_id, user_id) do update set role = excluded.role;

  update business_invites
     set accepted_at = now(), accepted_by = caller
   where id = invite.id;

  return invite.business_id;
end;
$$;
