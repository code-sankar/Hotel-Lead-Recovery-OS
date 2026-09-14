-- =============================================================================
-- Room availability.
--
-- Until now the product had no inventory, so the assistant was required to
-- defer every availability question to staff. This migration gives it real
-- numbers to answer from.
--
-- The model is deliberately allotment-based rather than per-physical-room:
--   * rooms.total_units      — how many rooms of this type the hotel has
--   * room_availability      — per-date OVERRIDES only (closed, or fewer units)
--   * bookings               — confirmed stays, which consume units per night
--
-- Availability for a room on a night is therefore:
--   (override.units_available ?? rooms.total_units) - units booked that night,
--   or zero when the date is closed.
--
-- Storing only overrides means a hotel never has to fill in a calendar to get
-- correct answers; they edit the exceptions.
-- =============================================================================

create type booking_status as enum ('confirmed', 'cancelled');

-- How many rooms of each type exist. 1 is a safe default: a hotel that has not
-- set this yet reports at most one unit rather than an invented number.
alter table rooms
  add column total_units integer not null default 1 check (total_units >= 0);

comment on column rooms.total_units is
  'Number of physical rooms of this type. The baseline for availability before per-date overrides and bookings.';

-- ---------------------------------------------------------------------------
-- Per-date overrides. A row exists only where the hotel has said something
-- different from the default for that room on that date.
-- ---------------------------------------------------------------------------
create table room_availability (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  room_id uuid not null references rooms (id) on delete cascade,
  date date not null,
  -- null means "use rooms.total_units"; a number overrides it for this date.
  units_available integer check (units_available >= 0),
  closed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, room_id, date)
);
create index room_availability_lookup_idx on room_availability (business_id, date, room_id);

-- ---------------------------------------------------------------------------
-- Confirmed stays. Created by staff when they mark a lead converted; the AI
-- never creates one, so "your booking is confirmed" remains a claim only the
-- application can make true.
-- ---------------------------------------------------------------------------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid references leads (id) on delete set null,
  customer_id uuid not null references customers (id) on delete cascade,
  room_id uuid not null references rooms (id) on delete restrict,
  check_in date not null,
  check_out date not null,
  units integer not null default 1 check (units > 0),
  guests integer check (guests > 0),
  status booking_status not null default 'confirmed',
  total_value numeric(12, 2),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A stay must span at least one night.
  constraint bookings_dates_ordered check (check_out > check_in)
);
create index bookings_business_dates_idx on bookings (business_id, check_in, check_out)
  where status = 'confirmed';
create index bookings_room_idx on bookings (room_id, check_in) where status = 'confirmed';
create index bookings_lead_idx on bookings (lead_id);

create trigger room_availability_touch_updated_at
  before update on public.room_availability
  for each row execute function public.touch_updated_at();

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table room_availability enable row level security;
alter table bookings          enable row level security;

-- Availability changes daily, so managers maintain it as well as owners.
create policy room_availability_select_member on room_availability
  for select to authenticated
  using (public.is_business_member(business_id));

create policy room_availability_write_manager on room_availability
  for all to authenticated
  using (public.has_business_role(business_id, array['owner', 'manager']::member_role[]))
  with check (public.has_business_role(business_id, array['owner', 'manager']::member_role[]));

-- Any member may record a booking, because whoever closes the deal records it.
create policy bookings_select_member on bookings
  for select to authenticated
  using (public.is_business_member(business_id));

create policy bookings_write_member on bookings
  for all to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
