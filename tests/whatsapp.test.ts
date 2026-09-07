import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppCloudProvider,
  normalisePhoneNumber,
  parseWhatsAppWebhook,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '@/lib/messaging/whatsapp-cloud';
import { decideOutboundKind, isServiceWindowOpen } from '@/lib/messaging/window';

const APP_SECRET = 'super-secret-app-secret';

function webhookBody(overrides: { messages?: unknown[]; statuses?: unknown[] } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: 'pn-123' },
              contacts: [{ profile: { name: 'Rahul Sharma' }, wa_id: '919000000001' }],
              ...(overrides.messages ? { messages: overrides.messages } : {}),
              ...(overrides.statuses ? { statuses: overrides.statuses } : {}),
            },
          },
        ],
      },
    ],
  };
}

describe('parseWhatsAppWebhook', () => {
  it('normalises a text message', () => {
    const events = parseWhatsAppWebhook(
      webhookBody({
        messages: [
          {
            from: '919000000001',
            id: 'wamid.ABC',
            timestamp: '1789000000',
            type: 'text',
            text: { body: 'Do you have a room for 15 Sept?' },
          },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.kind).toBe('message');
    if (event.kind !== 'message') return;
    expect(event.phoneNumberId).toBe('pn-123');
    expect(event.from).toBe('919000000001');
    expect(event.profileName).toBe('Rahul Sharma');
    expect(event.text).toBe('Do you have a room for 15 Sept?');
    expect(event.providerMessageId).toBe('wamid.ABC');
  });

  it('reads interactive button replies as customer text', () => {
    const events = parseWhatsAppWebhook(
      webhookBody({
        messages: [
          {
            from: '919000000001',
            id: 'wamid.BTN',
            type: 'interactive',
            interactive: { button_reply: { title: 'Yes, book it' } },
          },
        ],
      }),
    );
    expect(events[0]).toMatchObject({ text: 'Yes, book it' });
  });

  it('keeps non-text messages but with null text', () => {
    const events = parseWhatsAppWebhook(
      webhookBody({
        messages: [{ from: '919000000001', id: 'wamid.IMG', type: 'image' }],
      }),
    );
    expect(events[0]).toMatchObject({ messageType: 'image', text: null });
  });

  it('gives status updates a per-state event id so each one is distinct', () => {
    const events = parseWhatsAppWebhook(
      webhookBody({
        statuses: [
          { id: 'wamid.OUT', status: 'delivered', timestamp: '1789000100' },
          { id: 'wamid.OUT', status: 'read', timestamp: '1789000200' },
        ],
      }),
    );
    expect(events.map((e) => e.providerEventId)).toEqual(['wamid.OUT:delivered', 'wamid.OUT:read']);
  });

  it('returns nothing for junk payloads', () => {
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook({})).toEqual([]);
    expect(parseWhatsAppWebhook({ entry: 'nope' })).toEqual([]);
    expect(parseWhatsAppWebhook({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify(webhookBody({ messages: [] }));
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, signature, APP_SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(`${body} `, signature, APP_SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature(body, signature, 'other-secret')).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifyWebhookSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=', APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'garbage', APP_SECRET)).toBe(false);
  });

  it('rejects when no app secret is configured', () => {
    expect(verifyWebhookSignature(body, signature, '')).toBe(false);
  });
});

describe('verifyWebhookChallenge', () => {
  it('echoes the challenge when the verify token matches', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token-123',
      'hub.challenge': '9876',
    });
    expect(verifyWebhookChallenge(params, 'token-123')).toEqual({ ok: true, challenge: '9876' });
  });

  it('refuses a wrong token, wrong mode or missing challenge', () => {
    const base = { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-123', 'hub.challenge': '1' };
    expect(
      verifyWebhookChallenge(new URLSearchParams({ ...base, 'hub.verify_token': 'nope' }), 'token-123').ok,
    ).toBe(false);
    expect(
      verifyWebhookChallenge(new URLSearchParams({ ...base, 'hub.mode': 'unsubscribe' }), 'token-123').ok,
    ).toBe(false);
    expect(verifyWebhookChallenge(new URLSearchParams({ ...base, 'hub.challenge': '' }), 'token-123').ok).toBe(
      false,
    );
    expect(verifyWebhookChallenge(new URLSearchParams(base), '').ok).toBe(false);
  });
});

describe('WhatsAppCloudProvider', () => {
  it('posts a text message to the Cloud API and returns the provider id', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT' }] }), { status: 200 }),
    );
    const provider = new WhatsAppCloudProvider({
      accessToken: 'token',
      phoneNumberId: 'pn-123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.sendTextMessage('919000000001', 'Hello');
    expect(result.status).toBe('sent');
    expect(result.providerMessageId).toBe('wamid.SENT');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/pn-123/messages');
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919000000001',
      type: 'text',
    });
  });

  it('reports an API error instead of pretending the message was sent', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid token', code: 190 } }), { status: 401 }),
    );
    const provider = new WhatsAppCloudProvider({
      accessToken: 'bad',
      phoneNumberId: 'pn-123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.sendTextMessage('919000000001', 'Hello');
    expect(result.status).toBe('failed');
    expect(result.providerMessageId).toBeNull();
    expect(result.error).toContain('Invalid token');
  });

  it('sends a template with ordered body parameters', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.TPL' }] }), { status: 200 }),
    );
    const provider = new WhatsAppCloudProvider({
      accessToken: 'token',
      phoneNumberId: 'pn-123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.sendTemplateMessage('919000000001', {
      name: 'follow_up_1',
      languageCode: 'en',
      bodyParameters: ['Rahul', 'Riverfront Residency'],
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: 'template',
      template: {
        name: 'follow_up_1',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Rahul' },
              { type: 'text', text: 'Riverfront Residency' },
            ],
          },
        ],
      },
    });
  });
});

describe('24-hour service window', () => {
  const now = new Date('2026-09-07T12:00:00Z');

  it('allows free-form replies inside the window', () => {
    const decision = decideOutboundKind('2026-09-07T02:00:00Z', now);
    expect(decision.kind).toBe('free_form');
    expect(isServiceWindowOpen('2026-09-07T02:00:00Z', now)).toBe(true);
  });

  it('requires a template once the window closes', () => {
    expect(decideOutboundKind('2026-09-05T12:00:00Z', now).kind).toBe('template');
    expect(isServiceWindowOpen('2026-09-05T12:00:00Z', now)).toBe(false);
  });

  it('requires a template when the customer has never written', () => {
    expect(decideOutboundKind(null, now).kind).toBe('template');
  });

  it('treats exactly 24 hours as still open', () => {
    expect(decideOutboundKind('2026-09-06T12:00:00Z', now).kind).toBe('free_form');
  });
});

describe('normalisePhoneNumber', () => {
  it('keeps digits only', () => {
    expect(normalisePhoneNumber('+91 90000 00001')).toBe('919000000001');
    expect(normalisePhoneNumber('(91) 9000-000-001')).toBe('919000000001');
  });
});
