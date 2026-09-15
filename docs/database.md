# Database

PostgreSQL on Supabase. All timestamps are `timestamptz` in UTC; hotel-local
rendering happens in the application using `businesses.timezone`.

Migrations, applied in order:

1. `20250101000000_init_schema.sql` — enums, tables, indexes
2. `20250101000100_functions.sql` — helpers, triggers, provisioning RPCs, the
   non-secret WhatsApp view
3. `20250101000200_rls_policies.sql` — Row Level Security
4. `20250201000000_room_availability.sql` — inventory, overrides, bookings
5. `20250301000000_staff_invites.sql` — invitations and the accept RPC
6. `20250301000100_system_events.sql` — the operational event log

## Tenancy

```
auth.users ─┬─ profiles
            └─ business_members ── businesses
                                     ├─ business_profiles      (1:1)
                                     ├─ business_settings      (1:1)
                                     ├─ whatsapp_integrations  (1:1, secrets)
                                     ├─ whatsapp_templates
                                     ├─ rooms · hotel_policies · hotel_faqs
                                     ├─ customers ── conversations ── messages
                                     │                    └─ leads ─┬─ lead_events
                                     │                              ├─ follow_ups
                                     │                              └─ staff_notes
                                     ├─ follow_up_rules
                                     ├─ ai_actions
                                     └─ analytics_events
```

Every tenant-owned table carries `business_id`. `webhook_events` is global with an
optional `business_id`, because an event may arrive before a tenant is resolved.

## Tables

| Table | Purpose | Notable constraints |
| --- | --- | --- |
| `profiles` | User details, keyed to `auth.users` | Created by an `on_auth_user_created` trigger |
| `businesses` | One hotel = one tenant | `messaging_mode` (`demo`/`live`), `is_demo`, `timezone`, `currency` |
| `business_members` | Membership + role | Unique `(business_id, user_id)` |
| `business_profiles` | Description, times, amenities, hours | 1:1 with the hotel |
| `rooms` | Bookable room types | `base_price >= 0`, `max_guests > 0`, `total_units >= 0` — the only prices the AI may quote |
| `room_availability` | Per-date **overrides** only: closed, or a different room count | Unique `(business_id, room_id, date)` |
| `bookings` | Confirmed stays, which consume inventory | `check_out > check_in`, `units > 0`; only staff create these |
| `hotel_policies` | Cancellation, payment, pets… | Typed enum |
| `hotel_faqs` | Question/answer pairs | Ordered |
| `business_settings` | Assistant + follow-up switches | `max_follow_ups` between 0 and 5 |
| `whatsapp_integrations` | Provider credentials | **No RLS policies for `authenticated`** |
| `whatsapp_templates` | Template identifiers per purpose | Unique `(business_id, purpose)` |
| `customers` | One guest per hotel | Unique `(business_id, phone_number)` — the same number is two records for two hotels |
| `conversations` | A thread with a guest | `mode` = `ai` / `human` / `paused` |
| `messages` | Every message either way | Unique `(business_id, provider_message_id)` where not null |
| `leads` | The commercial enquiry | Unique `(conversation_id)`; `lead_score` 0–100 |
| `lead_events` | Append-only audit trail | Drives attribution and the timeline |
| `follow_up_rules` | Per-hotel automation | Unique `(business_id, sequence_index)` |
| `follow_ups` | One scheduled or sent message | Unique `(business_id, dedupe_key)` |
| `ai_actions` | What the model decided, and why | Includes guardrail flags |
| `staff_notes` | Internal notes | |
| `analytics_events` | Lightweight metric stream | |
| `webhook_events` | Provider receipts | Unique `(provider, provider_event_id)` |
| `business_invites` | Pending and used invitations | Stores only a token **hash**; one live invite per email per hotel |
| `system_events` | Operational failures, deduplicated and counted | Unique `(business_id, fingerprint)` |

## Enums

- `member_role` — `owner`, `manager`, `staff`
- `conversation_mode` — `ai`, `human`, `paused`
- `message_direction`, `message_sender_type` (`customer`/`ai`/`staff`/`system`), `message_type`
- `message_delivery_status` — `pending`, `sent`, `delivered`, `read`, `failed`, **`simulated`**
- `lead_status` — `new`, `active`, `follow_up_due`, `hot`, `warm`, `cold`, `converted`, `lost`, `paused`
- `lead_temperature` — `hot`, `warm`, `cold`, `low`
- `lead_intent` — the eighteen classified intents
- `follow_up_trigger`, `follow_up_status`, `hotel_policy_type`
- `messaging_mode` — `demo`, `live`
- `whatsapp_connection_status`

`simulated` is a first-class delivery status precisely so demo traffic can never
be mistaken for a delivered WhatsApp message.

## Row Level Security

Helpers (both `SECURITY DEFINER`, so policies on `business_members` do not recurse):

```sql
public.is_business_member(business_id) → boolean
public.has_business_role(business_id, member_role[]) → boolean
```

| Table group | Read | Write |
| --- | --- | --- |
| Hotel configuration (`business_profiles`, `rooms`, `hotel_policies`, `hotel_faqs`, `business_settings`, `whatsapp_templates`) | any member | owner |
| `businesses` | any member | owner |
| `business_members` | self or any member | owner |
| `follow_up_rules` | any member | owner, manager |
| Operational (`customers`, `conversations`, `messages`, `leads`, `lead_events`, `staff_notes`, `follow_ups`, `bookings`) | any member | any member |
| `room_availability` | any member | owner, manager |
| `business_invites` | owner | owner (the invitee uses `SECURITY DEFINER` RPCs) |
| `system_events` | any member | owner, manager (resolve only; writes go through an RPC) |
| Telemetry (`ai_actions`, `analytics_events`) | any member | service role only |
| `whatsapp_integrations` | **nobody** (no policies) | service role only |
| `webhook_events` | **nobody** | service role only |

The service role bypasses RLS; `SupabaseStore` therefore filters every query by
`business_id` explicitly, and `MemoryStore` enforces the same rule so a
cross-tenant leak fails a test.

## Provisioning

`create_business_with_owner(name, timezone, currency)` is a `SECURITY DEFINER`
RPC that, in one transaction, creates the hotel, registers the caller as owner,
creates the profile/settings/integration rows, and seeds the two default
follow-up rules plus the default WhatsApp template identifiers. This avoids the
chicken-and-egg problem of inserting a business you are not yet a member of.

## Availability

Availability is **computed, never stored**. For one room on one night:

```
units = closed ? 0 : (override.units_available ?? rooms.total_units)
free  = max(0, units - units booked that night)
```

A stay occupies the nights `[check_in, check_out)` — the checkout date is not a
night, so two stays may share a changeover day.

Storing only *overrides* means a hotel never has to fill in a calendar to get
correct answers: they record the exceptions (a closure, a reduced allotment) and
everything else falls back to the room type's own count. A hotel that has set
nothing reports `total_units` minus bookings, and a room type with zero units
reads as sold out rather than unlimited.

The arithmetic lives in `src/lib/availability/calculate.ts`, which is pure and
carries its own test file, because it is the factual basis for the one claim the
assistant used to be forbidden from making.
