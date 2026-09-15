# Architecture

## The shape of the system

```
                    ┌─────────────────────────────────────────────┐
  Guest (WhatsApp)  │  Meta Cloud API                             │
        │           └──────────────────┬──────────────────────────┘
        │                              │ webhook (signed)
        ▼                              ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  POST /api/webhooks/whatsapp                                  │
  │   1. rate limit                                               │
  │   2. parse (raw body kept for the HMAC)                       │
  │   3. map phone_number_id → business (tenant)                  │
  │   4. verify X-Hub-Signature-256 with that hotel's app secret  │
  │   5. record webhook_events  → duplicate? stop here            │
  │   6. enqueue, respond 200                                     │
  └────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Queue (BullMQ)     │   no Redis → inline via after()
                    └──────────┬──────────┘
                               ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  processInboundMessage()                                      │
  │   dedupe → customer → conversation → store message            │
  │   → lead → cancel pending follow-ups (the guest replied)      │
  │   → opt-out check                                             │
  │   → AI analyse (intent, entities, escalation)                 │
  │   → deterministic score → lead state                          │
  │   → reply gate (AI? human? paused? disabled?)                 │
  │   → verify availability for the enquiry's dates               │
  │   → generate → guardrails → send → record                     │
  │   → apply model-requested actions                             │
  │   → schedule the next follow-up                               │
  └───────────────────────────────────────────────────────────────┘
```

## Ports and adapters

Two interfaces carry the weight.

### `Store` — `src/lib/db/store.ts`

Every write path (inbound pipeline, follow-up engine, demo simulation) depends on
this interface rather than on Supabase. Two implementations exist:

| Implementation | Where | Notes |
| --- | --- | --- |
| `SupabaseStore` | `src/lib/db/supabase-store.ts` | Service role. RLS does **not** apply, so every method takes `businessId` and every query filters on it. |
| `MemoryStore` | `tests/support/memory-store.ts` | Enforces the same constraints (provider-message uniqueness, follow-up dedupe keys, one lead per conversation, strict tenant scoping) so integration tests exercise real orchestration. |

Read paths that serve the UI do **not** go through the port. They use the
user-session Supabase client (`src/lib/db/queries.ts`) where RLS is the boundary.

### `MessagingProvider` — `src/lib/messaging/types.ts`

```ts
interface MessagingProvider {
  sendTextMessage(to, text): Promise<SendResult>;
  sendTemplateMessage(to, template): Promise<SendResult>;
  markMessageRead(providerMessageId): Promise<void>;
  processWebhook(payload): InboundEvent[];
}
```

- `WhatsAppCloudProvider` — the real Meta Cloud API client.
- `DemoMessagingProvider` — returns `status: 'simulated'` with a `demo:` id. It
  never contacts Meta and never claims it did.

`resolveMessagingProvider()` picks one per hotel: live mode **and** usable
credentials gets the Cloud API; anything else falls back to demo with a stated
reason.

## Services

| Service | File | Responsibility |
| --- | --- | --- |
| Inbound pipeline | `lib/pipeline/inbound.ts` | Orchestrates one inbound message end to end |
| Outbound | `lib/pipeline/outbound.ts` | The single path every outbound message takes; enforces the 24-hour window |
| Lead scoring | `lib/leads/scoring.ts` | Deterministic signal → score → temperature |
| Lead state | `lib/leads/status.ts` | Documented state machine |
| Knowledge | `lib/knowledge/` | The trusted hotel snapshot and its prompt rendering |
| Availability | `lib/availability/` | Pure inventory arithmetic, the lookup service, and editing |
| AI | `lib/ai/` | Classification, generation, guardrails, two providers |
| Follow-up engine | `lib/followups/engine.ts` | Pure decisions: schedule / skip / still-eligible |
| Follow-up service | `lib/followups/service.ts` | Applies decisions to the database and provider |
| Analytics | `lib/analytics/metrics.ts` | Dashboard metrics and revenue attribution |
| Queue | `lib/queue/` | BullMQ, with an inline development fallback |
| Team | `lib/team/` | Invite tokens and the join flow |
| Monitoring | `lib/monitoring/` | Fingerprinting and the durable event log |

## Idempotency

Redelivery is normal with Meta, and retries are normal with BullMQ, so duplication
is designed out at four levels:

1. `webhook_events` has a unique `(provider, provider_event_id)`; a redelivered
   event is recorded once and never re-queued.
2. `messages` has a unique `(business_id, provider_message_id)`; the pipeline
   short-circuits on a message it has already stored.
3. Job ids are derived from the payload, so BullMQ drops duplicate enqueues.
4. `follow_ups` has a unique `(business_id, dedupe_key)`. The key is
   `lead:<id>:seq:<n>:r<revision>` — constant across job retries, advancing only
   when a follow-up is cancelled, so a guest who goes quiet twice can be followed
   up twice without ever getting the same message twice.

## Security boundaries

- **Tenant isolation** — RLS on every business-owned table. Reads run as the user;
  the service role is confined to the webhook, the worker and demo tooling, where
  `business_id` is always explicit.
- **Never trust a client id** — every server action loads the record, reads its
  `business_id` from the database, and only then checks the caller's membership and
  capability (`assertCapabilityFor`).
- **Secrets** — `whatsapp_integrations` has *no* policies for `authenticated`, so
  the browser cannot read it at all. Settings render a definer view exposing only
  booleans and status.
- **Webhook authenticity** — HMAC-SHA256 over the raw body, compared in constant
  time, against that hotel's app secret.
- **Cron authenticity** — constant-time comparison against `CRON_SECRET`.

## Request/response boundaries

The webhook does no AI work. It verifies, records and enqueues, then returns 200 —
anything slower risks a Meta retry and a duplicate reply. With Redis, work moves to
the worker; without it, `after()` runs the job once the response has been sent.

## Invitations

An owner creates an invite and receives a link **once**. The database stores only
a SHA-256 hash of the token, computed in the application, so a leaked row cannot
be redeemed and the plaintext never reaches Postgres logs.

The recipient is by definition not yet a member, so they cannot read the invite
row under RLS. Two `SECURITY DEFINER` functions bridge that:
`preview_business_invite` (hotel name, invited address, status) and
`accept_business_invite`, which re-checks the hash, the expiry, the revocation
and that the signed-in user's email matches the invited address — a forwarded
link cannot hand access to a stranger.

`/invite/[token]` is on the proxy's public path list, because the recipient
usually has no account yet.

## Monitoring

`logError` / `logWarning` write two places: a structured JSON console line for
whatever log drain the host provides, and a durable row so a 2am failure is
visible to someone who was not reading logs.

Events are deduplicated by a fingerprint of scope plus a normalised message —
ids, numbers, URLs and quoted values are replaced with placeholders — so a
provider outage that fails two thousand times is one row saying `2000`. A
recurrence reopens a row that was marked resolved.

Recording never throws. Monitoring that breaks the thing it monitors is worse
than no monitoring, so every failure inside the logger is swallowed after a
console line, and events without a known tenant stay console-only rather than
being written somewhere nobody can read them.
