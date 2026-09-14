# Lead Stay

WhatsApp-first lead recovery for independent hotels.

> **Stop losing hotel enquiries because nobody followed up.**

An enquiry arrives on WhatsApp. The system captures it, works out what the guest
wants, answers from the hotel's own information, scores the lead, and — if the
guest goes quiet — follows up automatically, up to a strict limit. Staff can take
over at any moment. When a booking happens, the hotel records the revenue and the
dashboard shows how much of it followed a recovery message.

That is the whole product. It is deliberately **not** a PMS, a channel manager, a
booking engine, or a general-purpose chatbot builder.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [OpenAI setup](#openai-setup)
- [WhatsApp setup](#whatsapp-setup)
- [Redis and the worker](#redis-and-the-worker)
- [Demo mode](#demo-mode)
- [Testing](#testing)
- [Deployment](#deployment)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## What it does

```
Guest on WhatsApp
   └─ Meta Cloud API webhook
        └─ tenant resolved from phone_number_id
             └─ customer + conversation + message stored          (idempotent)
                  └─ intent + booking entities extracted
                       └─ lead created and scored                  (deterministic)
                            └─ availability verified for those dates
                            └─ reply generated from hotel data
                                 └─ guardrails verify every claim
                                      └─ sent, recorded, follow-up scheduled
                                           └─ guest goes quiet → follow-up sent
                                                └─ guest replies → follow-ups cancelled
                                                     └─ staff convert → revenue attributed
```

Five design commitments run through the whole codebase:

1. **Facts come from the database, not the model.** Prices, policies, room types
   and FAQs are structured records. The model writes sentences; it never decides
   what is true.
2. **Availability is verified, never asserted.** The app looks the guest's dates
   up in the hotel's own inventory before a word is written, and the assistant may
   only say a room is free when those numbers say so — or say the hotel is full
   when they say that. A reply that goes beyond what was verified is blocked
   before it is sent, not just discouraged in a prompt.
3. **Human override is absolute.** While a conversation is in `human` or `paused`
   mode, the assistant sends nothing.
4. **Every tenant is isolated in the database.** Row Level Security, not
   application checks, is the boundary.
5. **Attribution is evidence-based.** "Revenue from recovered leads" counts only
   conversions where the event log shows a follow-up actually reached the guest
   before they booked.

---

## Architecture

```
src/
  app/
    (auth)/            sign in, sign up, reset password
    (app)/             dashboard · conversations · leads · follow-ups · analytics · settings · demo
    onboarding/        hotel → rooms → policies → FAQs
    api/
      webhooks/whatsapp/   Meta Cloud API webhook (signature-verified, idempotent)
      cron/follow-ups/     scheduled sweep for deployments without a worker
  lib/
    ai/                intent · entities · prompts · guardrails · OpenAI + rule-based providers
    availability/      pure inventory arithmetic · lookup service · editing actions
    analytics/         dashboard metrics and revenue attribution
    auth/              session, roles, capabilities
    conversations/     staff actions (send, take over, convert, assign, note)
    db/                Store port · Supabase adapter · RLS-scoped read queries
    demo/              demo hotel data, seeding, simulation
    followups/         decision engine (pure) + execution service
    knowledge/         the trusted hotel snapshot handed to the AI
    leads/             deterministic scoring + lead state machine
    messaging/         MessagingProvider port · WhatsApp Cloud API · demo transport · 24h window
    pipeline/          inbound processing · the single outbound path
    queue/             BullMQ, with an inline fallback for local development
    security/          rate limiting, constant-time comparison
    validation/        Zod schemas for every action input
  workers/             BullMQ worker + job processors
supabase/migrations/   schema · functions · RLS policies
tests/                 unit + integration (the pipeline runs against an in-memory Store)
docs/                  architecture · database · ai · whatsapp · followups
```

Two ports keep the core testable and swappable:

- **`Store`** (`src/lib/db/store.ts`) — every write path depends on this interface,
  not on Supabase. The integration tests run the real pipeline against an
  in-memory implementation, so what they exercise is production orchestration
  logic rather than a mock of it.
- **`MessagingProvider`** (`src/lib/messaging/types.ts`) — WhatsApp Cloud API is
  one implementation; the demo transport is another. Adding SMS later means adding
  a provider, not rewriting the pipeline.

More detail in [`docs/architecture.md`](docs/architecture.md).

---

## Local setup

Requirements: Node 20+ (developed on 22), a Supabase project, and optionally Redis.

The git repository is still named `Hotel-Lead-Recovery-OS`; the product is
**Lead Stay**.

```bash
git clone <this repo>
cd Hotel-Lead-Recovery-OS
npm install
cp .env.example .env.local     # fill in the Supabase values
npm run dev                    # http://localhost:3000
```

**Not configured yet?** Every route redirects to `/setup`, which checks your
environment variables, whether Supabase is reachable, and whether the migrations
have been applied — and tells you how to fix whatever is missing. Visit it any
time to diagnose a broken environment.

Then:

1. Sign up at `/signup`.
2. Create your hotel and walk through onboarding (hotel → rooms → policies → FAQs).
3. Open **Demo mode** and click *Load demo hotel and conversations*, or simulate a
   single message to watch the pipeline run.

---

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser/SSR client key; RLS applies |
| `SUPABASE_SERVICE_ROLE_KEY` | for webhook, worker, demo | Bypasses RLS — server only, never sent to the browser |
| `NEXT_PUBLIC_APP_URL` | yes | Used for auth redirects and the displayed webhook URL |
| `DEMO_MODE_ENABLED` | no (default on) | Set `false` to hide simulation tooling in production |
| `CRON_SECRET` | for the cron route | Shared secret for `POST /api/cron/follow-ups` |
| `OPENAI_API_KEY` | no | Without it, the deterministic engine writes replies |
| `OPENAI_MODEL` | no | Defaults to `gpt-4.1-mini` |
| `WHATSAPP_ACCESS_TOKEN` | no | Fallback token when a hotel has none stored |
| `WHATSAPP_VERIFY_TOKEN` | no | Fallback for Meta's GET handshake |
| `WHATSAPP_PHONE_NUMBER_ID` | no | Fallback sending number |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | no | Recorded for reference |
| `WHATSAPP_APP_SECRET` | no | Fallback webhook signature secret |
| `WHATSAPP_API_VERSION` | no | Defaults to `v21.0` |
| `REDIS_URL` | no | Enables BullMQ; without it jobs run inline (development only) |

Per-hotel WhatsApp credentials entered in **Settings → WhatsApp** take precedence
over the environment values. Secrets are write-only in the UI: once stored, the
settings page shows only whether a value exists.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/`, in filename order:
   - `20250101000000_init_schema.sql` — tables, enums, indexes
   - `20250101000100_functions.sql` — helpers, triggers, provisioning RPCs, the
     non-secret WhatsApp status view
   - `20250101000200_rls_policies.sql` — Row Level Security

   With the Supabase CLI:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   Or paste each file into the SQL editor in order.
3. Copy the project URL, anon key and service role key into `.env.local`.
4. Under **Authentication → URL Configuration**, add
   `http://localhost:3000/auth/callback` as a redirect URL.

See [`docs/database.md`](docs/database.md) for the schema and the RLS model.

---

## OpenAI setup

Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`). Requests use the **Responses
API**: structured outputs for classification, function calling for controlled
lookups and actions. All calls are server-side; the key never reaches the browser.

**Without a key the product still works.** A deterministic rule-based engine
answers from the same hotel data, and every message it writes is stamped
`rules-v1` in the database and labelled in the conversation view — it is a
declared fallback, never a pretend model. The same engine catches OpenAI failures
so a guest is never left without a reply.

See [`docs/ai.md`](docs/ai.md).

---

## WhatsApp setup

The integration uses the **official Meta WhatsApp Business Platform (Cloud API)**.
No WhatsApp Web automation, no browser drivers, no guest credentials.

1. Create a Meta app, add the WhatsApp product, and register your business number.
2. Generate a permanent system-user token with `whatsapp_business_messaging`.
3. In **Settings → WhatsApp**, enter the phone number ID, access token, app secret
   and a verify token of your choosing.
4. In Meta, set the callback URL to `https://<your-domain>/api/webhooks/whatsapp`,
   use the same verify token, and subscribe to the `messages` field.
5. Create and get approval for the follow-up templates named on the Follow-ups
   settings page (`leadstay_follow_up_1`, `leadstay_follow_up_2`, `leadstay_reengagement`).
6. Switch messaging mode to **Live**.

Step 5 is not optional: WhatsApp only permits free-form messages within 24 hours
of the guest's last message, and follow-ups by definition land outside it. Until
the templates are approved, live follow-ups are recorded as **failed with the
reason** — never silently dropped.

See [`docs/whatsapp.md`](docs/whatsapp.md).

---

## Redis and the worker

```bash
export REDIS_URL=redis://localhost:6379
npm run worker
```

The worker processes queued jobs and sweeps for due follow-ups every minute.
Follow-ups live in the database, so the queue is a delivery mechanism, not the
source of truth — a lost job is picked up by the next sweep.

Without `REDIS_URL`, jobs run in-process after the HTTP response is sent. That is
fine for development and **not** suitable for production.

Two alternatives to a long-running worker:

```bash
npm run followups:run                      # one-shot sweep, e.g. from cron
curl -X POST https://your-app/api/cron/follow-ups \
     -H "Authorization: Bearer $CRON_SECRET"   # e.g. Vercel Cron
```

---

## Demo mode

Demo mode exists so the product is fully usable — and demonstrable — before a Meta
number is connected.

- **Settings → WhatsApp → Demo** is the default for a new hotel.
- The **Demo mode** page can simulate an inbound message, rewind an enquiry by 25
  hours so its follow-up is due, run the follow-up engine, and seed twelve
  invented guests across every lead state.
- `npm run db:seed -- --email you@example.com` does the same from the CLI.

Everything runs the **real** pipeline: same classification, same scoring, same
guardrails, same follow-up rules. Only the transport is simulated, and those
messages are stored with `delivery_status = 'simulated'` and rendered with a
`demo · not sent` label. Demo actions refuse to run against a hotel in live mode.

A complete demo run:

1. Simulate `Hi, room available for 15 Sept?` → the assistant checks the date in
   your inventory and answers with the room types that are actually free, at your
   real rates. A lead appears, scored 35 (cold).
2. Simulate `2` → guests recorded, score 50 (warm).
3. Rewind 25 hours, then run the follow-up engine → a follow-up is sent.
4. Simulate `Yes, book it` → score jumps to hot, the pending follow-up is cancelled.
5. Open the conversation, **Mark converted**, enter `5600`.
6. The dashboard shows the conversion under **revenue from recovered leads**,
   because the event log proves a follow-up preceded it.

---

## Testing

```bash
npm run typecheck
npm run lint
npm test
```

223 tests across 13 files:

| File | Covers |
| --- | --- |
| `scoring.test.ts` | Signal detection, weights, clamping, temperature bands, inactivity |
| `intent.test.ts` | Intent classification incl. Hinglish, escalation intents, opt-out |
| `entities.test.ts` | Dates, guest counts, nights, relative dates, entity merging |
| `guardrails.test.ts` | Availability, booking, payment, discount, price and room-name claims |
| `followups.test.ts` | Scheduling, every stop condition, quiet hours, send-time eligibility |
| `whatsapp.test.ts` | Webhook parsing, HMAC verification, challenge, Cloud API calls, 24h window |
| `pipeline.test.ts` | End-to-end integration against an in-memory `Store` |
| `attribution.test.ts` | The revenue attribution rule |
| `permissions.test.ts` | Role capability boundaries |
| `validation.test.ts` | Zod schemas for hotel data and action inputs |
| `reply-engine.test.ts` | Reply behaviour, escalation, FAQ matching, the model tool surface |
| `availability.test.ts` | Inventory arithmetic: bookings, closures, allotments, changeover days |
| `user-store.test.ts` | The session-scoped read store used by availability pages |

The integration suite (`tests/pipeline.test.ts`) runs the real inbound pipeline
and follow-up engine against an in-memory `Store`, covering: enquiry → lead →
scored reply; duplicate webhook handling; tenant isolation; human takeover
silencing the assistant; opt-out; follow-up scheduling, cancellation, the
two-message cap, and retry-safety; and the full enquiry → follow-up → reply →
conversion story.

---

## Deployment

- **App** — Vercel (or any Node host). Set the environment variables above.
- **Worker** — Railway, Render, Fly.io or a container. Same variables, plus
  `REDIS_URL`; run `npm run worker`.
- **Database** — Supabase hosted Postgres.
- **No worker?** Point a scheduler at `POST /api/cron/follow-ups` with `CRON_SECRET`.

Set `DEMO_MODE_ENABLED=false` in production once you are live.

---

## Known limitations

These are deliberate MVP boundaries, not oversights:

- **Availability is an allotment count, not a room chart.** The system tracks how
  many rooms of each type are free per night, not which physical room a guest is
  in. That is the right level for a WhatsApp enquiry; it is not a PMS.
- **No channel sync.** If you also sell on an OTA, those bookings are not visible
  here unless someone records them, so the counts can drift.
- **No alternative-date search.** When the requested dates are full the assistant
  says so and offers to check other dates; it does not go looking on its own.
- **No payment.** Staff record revenue by hand; the assistant never takes money.
- **Staff invitations are manual.** Add a `business_members` row in Supabase; there
  is no invitation email flow yet.
- **English-first.** Romanised Hindi/Hinglish enquiries are understood
  (`room hai?`, `price kya hai`, `2 person`), but replies are written in English.
- **Rate limiting is per-instance.** In-memory, so it does not coordinate across
  replicas. Put a shared limiter in front before relying on it.
- **Analytics are computed on read.** Fine at MVP volume; roll up into a table
  before a hotel has hundreds of thousands of messages.
- **Follow-up templates must be approved by Meta** before live follow-ups can be
  delivered outside the 24-hour window.

---

## Roadmap

Deliberately out of scope for this MVP, in rough order of value:

Alternative-date suggestions · OTA/channel sync so counts cannot drift ·
payment links (Razorpay) · direct booking ·
multilingual replies · website and Instagram lead capture · Google Business
Messages · OTA/channel-manager integrations · campaign broadcasts · staff
performance analytics · a data-driven replacement for the heuristic lead score.

The architecture is arranged so each of these is an addition rather than a rewrite:
scoring is one module behind one function, messaging is behind a provider port, and
the AI layer is behind a provider interface with the trusted-data boundary already
enforced.
