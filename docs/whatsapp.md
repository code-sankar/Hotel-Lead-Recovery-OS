# WhatsApp integration

Official **Meta WhatsApp Business Platform (Cloud API)** only. No WhatsApp Web
automation, no browser drivers, no guest credentials stored anywhere.

## Message flow

```
Guest → WhatsApp → Meta → POST /api/webhooks/whatsapp → queue → pipeline
                                                                    │
Guest ← WhatsApp ← Meta ← POST /{phone_number_id}/messages ←────────┘
```

## Inbound: `POST /api/webhooks/whatsapp`

1. **Rate limit** by client IP, before any parsing.
2. **Read the raw body.** The HMAC is over the exact bytes Meta sent; re-serialising
   parsed JSON breaks it.
3. **Parse** into channel-agnostic events (`parseWhatsAppWebhook`). Text, button
   replies and list replies all become customer text; media becomes a typed message
   with no text.
4. **Resolve the tenant** from `metadata.phone_number_id` via
   `whatsapp_integrations`. Unknown number → `200` so Meta stops retrying, and
   nothing is written.
5. **Verify `X-Hub-Signature-256`** against that hotel's app secret using a
   constant-time comparison. Failure → `401`.
6. **Record `webhook_events`.** The unique `(provider, provider_event_id)` makes a
   redelivery a no-op. Status updates get a per-state id (`wamid.X:delivered`,
   `wamid.X:read`) so each transition is its own event.
7. **Enqueue and return `200`.** No AI work happens on this request.

Delivery receipts update `messages.delivery_status`, so a failed send is visible in
the conversation rather than silently lost.

## The verification handshake

`GET /api/webhooks/whatsapp` answers Meta's subscription challenge, checking the
presented token against the hotel's stored verify token or the environment
fallback, and echoing `hub.challenge` on success.

## Outbound and the 24-hour window

Meta only permits free-form replies within 24 hours of the guest's last message.
Outside it, an approved template is required. That is modelled explicitly rather
than assumed:

```ts
decideOutboundKind(conversation.last_inbound_at, now)
// → { kind: 'free_form' | 'template', reason, remainingMs }
```

`sendOutboundMessage()` is the single outbound path. When the window is closed it
looks up the configured template for the message's purpose. If no active template
is configured, the send is **blocked with a stated reason** and — for a follow-up —
recorded as `failed`. It is never quietly dropped, and never sent as free-form in
the hope that it works.

This matters more than it first appears: the default first follow-up fires 24 hours
after the guest's last message, which is exactly when the window closes. **Live
follow-ups effectively always require an approved template.**

## Template configuration

Template *identifiers* are stored per hotel in `whatsapp_templates`, separately
from any message text:

| Purpose | Default name | Used for |
| --- | --- | --- |
| `follow_up_1` | `hlr_follow_up_1` | First automated follow-up |
| `follow_up_2` | `hlr_follow_up_2` | Second automated follow-up |
| `reengagement` | `hlr_reengagement` | Staff or assistant replies outside the window |

Suggested bodies are shown in Settings → Follow-ups. You must create and get these
approved in your own WhatsApp Business account; the app cannot do it for you.

## Setup checklist

1. Meta app with the WhatsApp product; register the business number.
2. Permanent system-user token with `whatsapp_business_messaging`.
3. Settings → WhatsApp: phone number ID, access token, app secret, verify token.
4. Meta → Configuration: callback `https://<domain>/api/webhooks/whatsapp`, the same
   verify token, subscribe to `messages`.
5. Create and get the three templates approved.
6. Switch messaging mode to **Live**.

Until step 6, the hotel stays in demo mode and every "send" is recorded as
`simulated` with a `demo · not sent` label.

## What is left to connect a real number

The code path is complete and tested — parsing, signature verification,
idempotency, sending text and templates, delivery receipts. What remains is
account configuration, not development: a Meta app, an approved number, a system
token, the webhook registered, and the three templates approved.
