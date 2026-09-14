# The AI layer

The assistant has a narrow job: understand the guest, answer from the hotel's own
data, collect the details a booking needs, and hand over to a human when it should.
It is not a general chatbot, and it is not the source of truth for anything.

## The division of labour

| Decision | Made by |
| --- | --- |
| What the guest wants (intent) | Model, cross-checked by a rule-based classifier |
| Dates, guests, nights, room preference | Deterministic extractor first; the model may only add |
| Lead score and temperature | **Deterministic code only** |
| What is true about the hotel | **Database only** |
| Whether a room is free | **The availability calculator, from the hotel's own inventory** |
| Whether to reply at all | Application (conversation mode + hotel settings) |
| Wording of the reply | Model |
| Whether the reply may be sent | **Guardrails, against the database** |
| Whether to follow up, and when | Follow-up rules engine |

The rule of thumb: **the model handles language, never truth.**

## Providers

`AiProvider` (`src/lib/ai/types.ts`) has two methods, `analyze()` and `reply()`.

### `OpenAiProvider`

Uses the OpenAI **Responses API**.

- `analyze()` — one call with a strict `json_schema` structured output, so intent,
  confidence, temperature, entities, `requires_human`, `requires_follow_up` and
  `suggested_action` arrive as typed data. No prose parsing.
- `reply()` — a tool-calling loop (max 4 rounds).
  - **Read tools** are answered by the application from the trusted snapshot:
    `get_hotel_profile`, `get_room_types`, `get_room_details`,
    `get_hotel_policies`, `get_faqs`, `get_business_hours`,
    `get_current_conversation_state`.
  - **Action tools** are *requests*, collected and returned to the pipeline, which
    validates and applies them: `flag_for_human`, `schedule_follow_up`,
    `cancel_follow_up`, `update_lead`. The model never writes to the database.

There is deliberately **no availability tool the model can call with dates of its
own choosing**. The application decides which dates to verify — the ones on the
enquiry — and hands the model the result. `get_current_conversation_state` returns
`availability_checked` plus the verified numbers, or `availability: null` when
nothing was checked. That keeps exactly one verified window per turn, which is
what makes the guardrail below enforceable.

### `RulesAiProvider`

A deterministic engine that classifies with the rule-based classifier and composes
replies from the same rooms, policies and FAQs. It is used when no OpenAI key is
configured, and as the fallback when an OpenAI call fails.

It is not a mock. Every message it produces is stamped `rules-v1` in
`messages.ai_model` and labelled in the conversation view, so nobody can mistake
it for model output.

## Guardrails

`src/lib/ai/guardrails.ts` re-checks the generated reply against the hotel snapshot
before anything is sent. It blocks:

| Flag | What it catches |
| --- | --- |
| `unverified_availability` | Said a room is free with no verified lookup, or for dates outside the one that was checked |
| `contradicts_availability` | Said a room is free when the verified numbers say it is not |
| `wrong_sold_out` | Said the hotel is full when the verified numbers say a room is free |
| `claimed_booking` | "Your booking is confirmed", "I've reserved…" |
| `claimed_payment` | "Payment received" |
| `invented_discount` | Any discount, special rate or complimentary offer |
| `invented_price` | A money amount that is not a configured rate (or a whole-number multiple of one, for multi-night totals), and was not quoted by the guest |
| `invented_room` | A room type the hotel has not created |
| `empty_reply` | The model returned nothing |

### Availability: verified, not forbidden

This is the one rule that changed when real inventory arrived. Availability
claims are checked **per clause**, so a reply may truthfully pair a free room
with a full one, and hedged statements are always allowed — deferring to a human
is never a false claim.

```
No lookup ran (no dates in the conversation):
  "Yes, we have a Deluxe Room available."                   → blocked
  "I'll need the team to confirm availability."             → allowed

Verified 15–17 Sept: Deluxe free, Suite sold out:
  "The Deluxe Room is available for those dates."           → allowed
  "The Suite is available for those dates."                 → blocked
  "The Deluxe is free, but the Suite is fully booked."      → allowed
  "Sorry, we're fully booked."                              → blocked
  "Yes, we have a Deluxe available on 25 December."         → blocked (wrong dates)
```

The failure mode matters: a hotel that has not configured any inventory produces
no verified lookup, so every positive claim is blocked and the assistant behaves
exactly as it did before this feature existed. Safety is the default, not an
add-on.

**A blocked reply is never rewritten into a different claim.** The hotel's own
escalation message is sent instead, the conversation moves to `human` mode, and
the flags are recorded on `ai_actions` for review.

## Intent classification

Eighteen intents (`src/types/domain.ts`). The rule-based classifier
(`src/lib/ai/intent.ts`) is ordered by escalation priority first, then commercial
specificity, and understands the romanised Hindi that Indian hotel enquiries
arrive in:

```
"room hai?"          → room_availability
"price kya hai"      → pricing
"2 person"           → guests = 2
"best price?"        → discount_request
"check in 2pm possible?" → check_in_out
```

`complaint`, `payment` and `human_help` always escalate: the pipeline skips
generation entirely, sends the hotel's escalation message verbatim, and hands the
conversation to staff.

## Lead scoring

Deterministic, in `src/lib/leads/scoring.ts`, and derived from the **set** of
signals observed across the conversation — so re-processing a message can never
inflate a score.

| Signal | Weight |
| --- | --- |
| Asked about availability | +20 |
| Gave travel dates | +15 |
| Gave guest count | +15 |
| Asked about price | +10 |
| Asked to book | +20 |
| Asked about payment | +20 |
| Asked about room options | +10 |
| Asked about location | +5 |
| Said they are just checking | −10 |
| Comparing other hotels | −10 |
| Went quiet (24h+) | −10 |
| Said they are not interested | −20 |

Clamped to 0–100. Bands: **80+ hot**, **50–79 warm**, **20–49 cold**, **0–19 low**.

One documented addition to the raw weights: asking to book or asking how to pay
floors the score at 80. A guest saying "book it" is a hot lead however few other
questions they happened to ask, and expressing that as a floor keeps the
individual weights honest.

The whole module is pure and I/O-free so it can be replaced by a data-driven model
behind the same function signature.

## The system prompt

Built per hotel in `src/lib/ai/prompts.ts`: eleven hard rules, a style section, and
the rendered hotel snapshot (rooms with prices and capacity, policies, FAQs, plus
an explicit statement that live inventory does not exist). Every hard rule is also
enforced in code — the prompt states the policy, the guardrails enforce it.
