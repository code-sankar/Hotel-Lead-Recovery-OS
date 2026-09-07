# The follow-up engine

This is the part of the product that makes money. Everything else exists so this
can run safely.

## The promise

A guest asks about a room, gets an answer, and then goes quiet. Today that enquiry
is simply lost. Here it is followed up — once, and if still quiet, once more —
and then left alone.

```
Guest:  "How much for a deluxe room?"
System: "₹2,800 per night, sleeps 2, breakfast included. Which dates?"
        … 24 hours of silence …
System: "Hi Rahul, just checking whether you had a chance to look at the room
         options. Happy to help with the booking whenever you're ready."
        … 48 more hours of silence …
System: "We're happy to help with your stay whenever you're ready. Would you
         like me to keep your enquiry open?"
        … and then nothing more, ever.
```

## Decide and execute are separate

`src/lib/followups/engine.ts` is pure: given a lead, its conversation, the
customer, the hotel's settings, the rules and the follow-ups already created, it
returns either a `schedule` decision (which rule, exactly when, with what text and
dedupe key) or a `skip` with a named reason. No I/O, fully unit-tested.

`src/lib/followups/service.ts` applies those decisions to the database and the
messaging provider.

## When a follow-up is scheduled

After every inbound message where the enquiry is still live. "Live" is judged from
the **lead's** standing intent, not only the last message — a guest replying "2" or
"let me check" classifies as `unknown`, but the enquiry is very much open.

## When automation stops

Checked twice: when scheduling, and again immediately before sending, because the
world may have changed in the intervening day.

| Stop condition | Reason recorded |
| --- | --- |
| The guest replied | `customer_replied` |
| The lead converted | `lead_converted` |
| The lead was marked lost | `lead_lost` |
| Staff took over | `human_takeover` |
| The conversation was paused | `conversation_paused` |
| The guest opted out | `customer_opted_out` |
| Follow-ups switched off | `follow_ups_disabled` |
| The limit was reached | `limit_reached` |
| Staff cancelled it | `cancelled_by_staff` |

The MVP cap is **two** automated follow-ups per lead (configurable 0–5). Beyond
that the system stops. It does not nag.

## Rules

Stored per hotel in `follow_up_rules`, editable in Settings → Follow-ups.

| Field | Meaning |
| --- | --- |
| `trigger` | `customer_inactive` (measured from the guest's last message) or `previous_follow_up_sent` |
| `delay_minutes` | How long to wait from that anchor |
| `sequence_index` | Step number; unique per hotel |
| `conditions` | e.g. `{"lead_status_not_in": ["converted","lost","paused"], "conversation_mode": "ai"}` |
| `message_template` | Text with `{{customer_name}}` |
| `whatsapp_template_purpose` | Which approved template to use outside the 24-hour window |

Defaults seeded with every hotel: step 1 at 24 hours from the guest's last message,
step 2 at 48 hours from the first follow-up.

## Quiet hours

Optional per hotel. A send that would land inside the quiet window is pushed
forward to the first hour outside it, in the hotel's own timezone. Windows that
wrap midnight (21:00 → 08:00) are handled.

## Never sending the same message twice

`follow_ups` has a unique `(business_id, dedupe_key)`, where the key is
`lead:<leadId>:seq:<n>:r<revision>`.

- **Constant across job retries** — a retried scheduler finds the existing row
  instead of creating a second one.
- **Advances after a cancellation** — `revision` counts follow-ups already created
  for that step, so a guest who replies (cancelling step 1) and then goes quiet
  again can be followed up once more, without colliding with the cancelled row.

Execution is guarded too: `executeFollowUp` refuses anything not still
`scheduled`, so a duplicate job is a no-op rather than a second message.

## Running the engine

The database is the source of truth; the queue is only delivery. Three ways to
drive it:

| Mode | Command | Use |
| --- | --- | --- |
| Worker | `npm run worker` | Production. Processes jobs and sweeps every 60s. |
| One-shot | `npm run followups:run` | Cron, or by hand while testing. |
| HTTP | `POST /api/cron/follow-ups` with `CRON_SECRET` | Deployments with no long-running process (Vercel Cron). |

Because due follow-ups are found by querying the database, a lost or expired job
never means a lost follow-up — the next sweep picks it up.

## The 24-hour reality

The default first follow-up fires 24 hours after the guest's last message, which is
precisely when WhatsApp's free-form window closes. In practice **live follow-ups
require an approved Meta template**. If none is configured, the follow-up is
recorded as `failed` with the reason, visible on the Follow-ups page. It is never
silently dropped, and never sent as free-form and hoped for.

## Attribution

`follow_up_sent` lead events are what make "revenue from recovered leads" real. A
conversion counts as recovered only if the log shows a follow-up reached that guest
**at or before** the moment they converted. Anything else is reported as total
booked revenue. The rule is a pure function (`partitionByFollowUp`) with its own
test file, because it is the number a hotel owner will judge the product on.
