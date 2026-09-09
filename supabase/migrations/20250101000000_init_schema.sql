-- =============================================================================
-- Lead Stay — core schema
--
-- Design rules enforced here:
--   * Every tenant-owned row carries business_id (tenant isolation key).
--   * All timestamps are UTC (timestamptz). Hotel-local rendering happens in
--     the application using businesses.timezone.
--   * Factual hotel data (rooms, policies, faqs) lives in structured columns so
--     the AI layer can never be the source of truth for prices or policy.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role as enum ('owner', 'manager', 'staff');

create type conversation_mode as enum ('ai', 'human', 'paused');
create type conversation_status as enum ('open', 'resolved');

create type message_direction as enum ('inbound', 'outbound');
create type message_sender_type as enum ('customer', 'ai', 'staff', 'system');
create type message_type as enum (
  'text', 'image', 'audio', 'video', 'document',
  'location', 'interactive', 'template', 'unsupported'
);
-- 'simulated' marks demo-mode messages that were never handed to Meta.
create type message_delivery_status as enum (
  'pending', 'sent', 'delivered', 'read', 'failed', 'simulated'
);

-- Lifecycle state of an enquiry. hot/warm/cold are open pipeline states that
-- mirror the current temperature; converted/lost are terminal.
create type lead_status as enum (
  'new', 'active', 'follow_up_due', 'hot', 'warm', 'cold', 'converted', 'lost', 'paused'
);
create type lead_temperature as enum ('hot', 'warm', 'cold', 'low');

create type lead_intent as enum (
  'room_availability', 'pricing', 'booking_intent', 'room_information',
  'hotel_information', 'amenities', 'location', 'check_in_out', 'cancellation',
  'payment', 'discount_request', 'group_booking', 'event_or_conference',
  'airport_transfer', 'restaurant_or_food', 'complaint', 'human_help', 'unknown'
);

create type follow_up_trigger as enum ('customer_inactive', 'previous_follow_up_sent');
create type follow_up_status as enum ('scheduled', 'sent', 'cancelled', 'failed', 'skipped');

create type hotel_policy_type as enum (
  'cancellation', 'child', 'extra_bed', 'check_in', 'check_out',
  'pet', 'payment', 'smoking', 'other'
);

create type messaging_mode as enum ('demo', 'live');
create type whatsapp_connection_status as enum ('not_configured', 'configured', 'verified', 'error');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text,
  address text,
  city text,
  state text,
  country text not null default 'India',
  phone text,
  website text,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  -- Demo businesses never send anything through Meta; the UI labels them.
  messaging_mode messaging_mode not null default 'demo',
  is_demo boolean not null default false,
  onboarding_completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create index business_members_user_idx on business_members (user_id);

-- ---------------------------------------------------------------------------
-- Hotel knowledge (trusted, application-controlled facts)
-- ---------------------------------------------------------------------------
create table business_profiles (
  business_id uuid primary key references businesses (id) on delete cascade,
  description text,
  location_note text,
  check_in_time text,
  check_out_time text,
  business_hours jsonb not null default '{}'::jsonb,
  amenities text[] not null default '{}',
  landmarks text,
  updated_at timestamptz not null default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  description text,
  base_price numeric(12, 2) not null check (base_price >= 0),
  max_guests integer not null default 2 check (max_guests > 0),
  amenities text[] not null default '{}',
  breakfast_included boolean not null default false,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_business_idx on rooms (business_id) where active;

create table hotel_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  type hotel_policy_type not null,
  title text,
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hotel_policies_business_idx on hotel_policies (business_id);

create table hotel_faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  question text not null,
  answer text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hotel_faqs_business_idx on hotel_faqs (business_id);

-- ---------------------------------------------------------------------------
-- Settings & integrations
-- ---------------------------------------------------------------------------
create table business_settings (
  business_id uuid primary key references businesses (id) on delete cascade,
  ai_enabled boolean not null default true,
  ai_tone text not null default 'friendly_professional',
  ai_welcome_message text,
  ai_escalation_message text not null
    default 'Let me get someone from our team to help you with this. They will reply here shortly.',
  follow_ups_enabled boolean not null default true,
  max_follow_ups integer not null default 2 check (max_follow_ups between 0 and 5),
  -- Per-step timing lives on follow_up_rules; this table holds the master switches.
  quiet_hours_start integer check (quiet_hours_start between 0 and 23),
  quiet_hours_end integer check (quiet_hours_end between 0 and 23),
  updated_at timestamptz not null default now()
);

-- Provider credentials. Secrets are written by the server and never selected
-- into the browser: RLS below exposes only the non-secret status columns via
-- the whatsapp_integration_status view.
create table whatsapp_integrations (
  business_id uuid primary key references businesses (id) on delete cascade,
  phone_number_id text unique,
  display_phone_number text,
  waba_id text,
  access_token text,
  app_secret text,
  verify_token text,
  status whatsapp_connection_status not null default 'not_configured',
  last_error text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Template identifiers/config kept separate from free-form message text so the
-- application can send an approved template when the 24h window is closed.
create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  purpose text not null,
  template_name text not null,
  language_code text not null default 'en',
  body_preview text,
  variable_map jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, purpose)
);

-- ---------------------------------------------------------------------------
-- Customers, conversations, messages
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  phone_number text not null,
  name text,
  email text,
  language text,
  notes text,
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone_number)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  mode conversation_mode not null default 'ai',
  status conversation_status not null default 'open',
  channel text not null default 'whatsapp',
  assigned_staff_id uuid references auth.users (id) on delete set null,
  taken_over_by uuid references auth.users (id) on delete set null,
  taken_over_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_business_activity_idx
  on conversations (business_id, last_message_at desc nulls last);
create index conversations_customer_idx on conversations (customer_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction message_direction not null,
  sender_type message_sender_type not null,
  sender_user_id uuid references auth.users (id) on delete set null,
  message_type message_type not null default 'text',
  text text,
  provider_message_id text,
  template_name text,
  delivery_status message_delivery_status,
  ai_model text,
  raw_payload jsonb,
  error text,
  created_at timestamptz not null default now()
);
-- Idempotency: a provider message id may only be stored once per tenant.
create unique index messages_provider_unique_idx
  on messages (business_id, provider_message_id)
  where provider_message_id is not null;
create index messages_conversation_idx on messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  status lead_status not null default 'new',
  temperature lead_temperature not null default 'low',
  lead_score integer not null default 0 check (lead_score between 0 and 100),
  intent lead_intent not null default 'unknown',
  estimated_value numeric(12, 2),
  expected_check_in date,
  expected_check_out date,
  guests integer check (guests > 0),
  room_preference text,
  source text not null default 'whatsapp',
  assigned_staff_id uuid references auth.users (id) on delete set null,
  follow_ups_sent integer not null default 0,
  last_customer_message_at timestamptz,
  last_response_at timestamptz,
  next_follow_up_at timestamptz,
  converted_at timestamptz,
  conversion_value numeric(12, 2),
  lost_at timestamptz,
  loss_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One open lead per conversation keeps the pipeline unambiguous.
  unique (conversation_id)
);
create index leads_business_status_idx on leads (business_id, status);
create index leads_follow_up_due_idx on leads (next_follow_up_at)
  where next_follow_up_at is not null;

create table lead_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  type text not null,
  actor_type text not null default 'system',
  actor_user_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events (lead_id, created_at desc);
create index lead_events_business_type_idx on lead_events (business_id, type, created_at desc);

create table staff_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid references leads (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index staff_notes_lead_idx on staff_notes (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Follow-up engine
-- ---------------------------------------------------------------------------
create table follow_up_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  trigger follow_up_trigger not null,
  delay_minutes integer not null check (delay_minutes > 0),
  sequence_index integer not null default 1 check (sequence_index >= 1),
  conditions jsonb not null default '{}'::jsonb,
  message_template text not null,
  whatsapp_template_purpose text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sequence_index)
);

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  rule_id uuid references follow_up_rules (id) on delete set null,
  sequence_index integer not null default 1,
  status follow_up_status not null default 'scheduled',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  message_id uuid references messages (id) on delete set null,
  body text,
  attempts integer not null default 0,
  last_error text,
  created_by text not null default 'system',
  -- Guarantees a retried job can never schedule the same step twice.
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, dedupe_key)
);
create index follow_ups_due_idx on follow_ups (scheduled_for) where status = 'scheduled';
create index follow_ups_lead_idx on follow_ups (lead_id, sequence_index);

-- ---------------------------------------------------------------------------
-- AI decisions & telemetry
-- ---------------------------------------------------------------------------
create table ai_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  lead_id uuid references leads (id) on delete set null,
  inbound_message_id uuid references messages (id) on delete set null,
  outbound_message_id uuid references messages (id) on delete set null,
  provider text not null,
  model text,
  intent lead_intent,
  confidence numeric(4, 3),
  requires_human boolean not null default false,
  requires_follow_up boolean not null default false,
  suggested_action text,
  entities jsonb not null default '{}'::jsonb,
  decision text not null,
  guardrail_flags text[] not null default '{}',
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index ai_actions_conversation_idx on ai_actions (conversation_id, created_at desc);

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  type text not null,
  lead_id uuid references leads (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  value numeric(12, 2),
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index analytics_events_business_idx on analytics_events (business_id, type, occurred_at desc);

-- Inbound webhook receipts. The unique provider_event_id makes redelivery a
-- no-op instead of a duplicate message/lead/follow-up.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'whatsapp',
  provider_event_id text not null,
  business_id uuid references businesses (id) on delete set null,
  status text not null default 'received',
  payload jsonb,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);
create index webhook_events_received_idx on webhook_events (received_at desc);
