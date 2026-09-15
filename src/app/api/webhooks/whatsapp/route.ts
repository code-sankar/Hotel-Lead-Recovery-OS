import { NextResponse, after, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { getServiceStore } from '@/lib/db/supabase-store';
import {
  normalisePhoneNumber,
  parseWhatsAppWebhook,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '@/lib/messaging/whatsapp-cloud';
import type { InboundMessageEvent, InboundStatusEvent } from '@/lib/messaging/types';
import type { MessageType } from '@/types/domain';
import { enqueue } from '@/lib/queue';
import { clientKeyFrom, rateLimit } from '@/lib/security/rate-limit';
import { logError, logWarning } from '@/lib/monitoring/logger';

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * Responsibilities, in order: verify the request is really from Meta, map the
 * phone number id to a tenant, record the event for idempotency, queue the AI
 * work, and return 200 quickly. No AI or messaging work happens on this
 * request — Meta retries anything slow, which would duplicate replies.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — Meta's subscription handshake. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const store = getServiceStore();

  // The verify token may be configured per hotel or fall back to the env value.
  const candidates = new Set<string>();
  const envToken = serverEnv().WHATSAPP_VERIFY_TOKEN;
  if (envToken) candidates.add(envToken);

  const presentedToken = params.get('hub.verify_token');
  if (presentedToken) {
    try {
      const business = await store.findBusinessByPhoneNumberId(params.get('phone_number_id') ?? '');
      if (business) {
        const integration = await store.getWhatsAppIntegration(business.id);
        if (integration?.verify_token) candidates.add(integration.verify_token);
      }
    } catch {
      // Fall through to the env token only.
    }
  }

  for (const token of candidates) {
    const result = verifyWebhookChallenge(params, token);
    if (result.ok && result.challenge) {
      return new NextResponse(result.challenge, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
  }

  return new NextResponse('Forbidden', { status: 403 });
}

const MESSAGE_TYPES: readonly string[] = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'location',
  'interactive',
  'template',
];

function toMessageType(raw: string): MessageType {
  return (MESSAGE_TYPES.includes(raw) ? raw : 'unsupported') as MessageType;
}

export async function POST(request: NextRequest) {
  // Cheap flood protection before any parsing or database work.
  const limit = rateLimit(`whatsapp-webhook:${clientKeyFrom(request.headers)}`, 600, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // The raw body is required: re-serialising the parsed JSON breaks the HMAC.
  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const events = parseWhatsAppWebhook(payload);
  if (events.length === 0) {
    // Status-only or unrecognised payloads are still a successful delivery.
    return NextResponse.json({ received: true });
  }

  const store = getServiceStore();
  const signature = request.headers.get('x-hub-signature-256');
  const env = serverEnv();

  // Every event in one delivery shares a phone number id, so the tenant and its
  // app secret are resolved once.
  const phoneNumberId = events[0]!.phoneNumberId;
  const business = await store.findBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    // Unknown number: acknowledge so Meta stops retrying, but do nothing.
    // No tenant means no row anyone could be shown; the log line is the trace.
    console.warn(
      JSON.stringify({
        level: 'warning',
        scope: 'whatsapp.webhook',
        message: 'Webhook for a phone_number_id that is not mapped to any hotel.',
        phoneNumberId,
      }),
    );
    return NextResponse.json({ received: true, mapped: false });
  }

  const integration = await store.getWhatsAppIntegration(business.id);
  const appSecret = integration?.app_secret ?? env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    await logError({
      scope: 'whatsapp.webhook',
      businessId: business.id,
      message: 'No WhatsApp app secret is configured, so incoming messages cannot be verified.',
      detail: { phoneNumberId },
    });
    return NextResponse.json({ error: 'not_configured' }, { status: 403 });
  }
  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    // Either the app secret is wrong or something is impersonating Meta. Both
    // are worth surfacing, because inbound enquiries stop either way.
    await logWarning({
      scope: 'whatsapp.webhook',
      businessId: business.id,
      message: 'Rejected a webhook whose signature did not match the configured app secret.',
      detail: { phoneNumberId, hasSignature: Boolean(signature) },
    });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const queued: Array<() => Promise<unknown>> = [];

  for (const event of events) {
    // Idempotency: a redelivered event is recorded once and never re-processed.
    const { isNew } = await store.recordWebhookEvent({
      provider: 'whatsapp',
      providerEventId: event.providerEventId,
      businessId: business.id,
      payload: event.raw,
    });
    if (!isNew) continue;

    if (event.kind === 'status') {
      queued.push(() => applyStatusUpdate(business.id, event));
    } else {
      queued.push(() => queueInbound(business.id, event));
    }
  }

  // Meta expects a fast 200; the work continues after the response is sent.
  after(async () => {
    for (const task of queued) {
      try {
        await task();
      } catch (error) {
        // The 200 has already gone to Meta, so this is the only trace there
        // would otherwise be of a dropped enquiry.
        await logError({
          scope: 'whatsapp.webhook',
          businessId: business.id,
          error,
          message: 'An inbound WhatsApp message could not be processed.',
          detail: { phoneNumberId },
        });
      }
    }
  });

  return NextResponse.json({ received: true, events: queued.length });
}

async function queueInbound(businessId: string, event: InboundMessageEvent): Promise<unknown> {
  return enqueue('process_inbound_message', {
    businessId,
    phoneNumber: normalisePhoneNumber(event.from),
    profileName: event.profileName,
    text: event.text,
    messageType: toMessageType(event.messageType),
    providerMessageId: event.providerMessageId,
    rawPayload: event.raw,
    webhookEventId: event.providerEventId,
  });
}

/** Delivery receipts update the stored message so failures are visible in the UI. */
async function applyStatusUpdate(businessId: string, event: InboundStatusEvent): Promise<void> {
  const store = getServiceStore();
  const message = await store.findMessageByProviderId(businessId, event.providerMessageId);
  if (!message) return;

  const status = ['sent', 'delivered', 'read', 'failed'].includes(event.status)
    ? (event.status as 'sent' | 'delivered' | 'read' | 'failed')
    : null;
  if (!status) return;

  await store.updateMessage(businessId, message.id, { delivery_status: status });
  await store.markWebhookEventProcessed(event.providerEventId, 'processed');
}
