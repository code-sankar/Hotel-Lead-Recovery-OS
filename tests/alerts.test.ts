import { describe, expect, it, vi } from 'vitest';
import {
  buildAlertPayload,
  deliverAlert,
  describeScope,
  meetsLevel,
  signAlertBody,
  type AlertContext,
} from '@/lib/monitoring/alerts';

/**
 * Alerting has one job beyond delivery: not sending two thousand messages for
 * one outage, and not being the thing that breaks. Both are pinned down here;
 * the per-failure cooldown itself is decided atomically in SQL.
 */

function context(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    level: 'error',
    scope: 'followup.send',
    message: 'A follow-up could not be sent: no approved template.',
    businessId: 'biz-1',
    businessName: 'Riverfront Residency',
    occurrences: 1,
    isNew: true,
    healthUrl: 'https://app.example.com/settings/health',
    ...overrides,
  };
}

describe('alert payload', () => {
  it('names the hotel, what broke, and where to go', () => {
    const payload = buildAlertPayload(context());
    expect(payload.text).toContain('Riverfront Residency');
    expect(payload.text).toContain('Sending a follow-up');
    expect(payload.text).toContain('no approved template');
    expect(payload.text).toContain('https://app.example.com/settings/health');
  });

  it('carries the same text for Slack and Discord, which read different keys', () => {
    const payload = buildAlertPayload(context());
    expect(payload.content).toBe(payload.text);
  });

  it('says when a failure is repeating rather than new', () => {
    expect(buildAlertPayload(context({ occurrences: 42, isNew: false })).text).toContain(
      '42 times, still happening',
    );
    expect(buildAlertPayload(context()).text).not.toContain('times');
  });

  it('marks errors and warnings differently at a glance', () => {
    expect(buildAlertPayload(context({ level: 'error' })).text).toContain('🔴');
    expect(buildAlertPayload(context({ level: 'warning' })).text).toContain('🟠');
  });

  it('keeps the structured fields a custom receiver would route on', () => {
    const payload = buildAlertPayload(context(), new Date('2026-09-15T10:00:00Z'));
    expect(payload).toMatchObject({
      level: 'error',
      scope: 'followup.send',
      business: { id: 'biz-1', name: 'Riverfront Residency' },
      occurrences: 1,
      isNew: true,
      source: 'lead-stay',
      sentAt: '2026-09-15T10:00:00.000Z',
    });
  });

  it('still reads sensibly with no health link', () => {
    const payload = buildAlertPayload(context({ healthUrl: undefined }));
    expect(payload.url).toBeUndefined();
    expect(payload.text).toContain('Riverfront Residency');
  });

  it('translates internal scopes into plain language', () => {
    expect(describeScope('whatsapp.webhook')).toBe('Incoming WhatsApp');
    expect(describeScope('something.unmapped')).toBe('something.unmapped');
  });
});

describe('level filtering', () => {
  it('sends only errors when the channel is set to error', () => {
    expect(meetsLevel('error', 'error')).toBe(true);
    expect(meetsLevel('warning', 'error')).toBe(false);
  });

  it('sends everything when the channel is set to warning', () => {
    expect(meetsLevel('error', 'warning')).toBe(true);
    expect(meetsLevel('warning', 'warning')).toBe(true);
  });
});

describe('signing', () => {
  it('signs deterministically in the sha256=<hex> form', () => {
    const signature = signAlertBody('{"a":1}', 'secret');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signAlertBody('{"a":1}', 'secret')).toBe(signature);
  });

  it('changes when the body or the secret changes', () => {
    const base = signAlertBody('{"a":1}', 'secret');
    expect(signAlertBody('{"a":2}', 'secret')).not.toBe(base);
    expect(signAlertBody('{"a":1}', 'other')).not.toBe(base);
  });
});

describe('delivery', () => {
  it('posts JSON and reports success', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const result = await deliverAlert('https://hooks.example.com/x', buildAlertPayload(context()), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/x');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body)).source).toBe('lead-stay');
  });

  it('adds a signature header only when a secret is configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));

    await deliverAlert('https://x.test', buildAlertPayload(context()), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const withoutSecret = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((withoutSecret.headers as Record<string, string>)['x-leadstay-signature']).toBeUndefined();

    await deliverAlert('https://x.test', buildAlertPayload(context()), {
      secret: 'shhh',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const withSecret = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((withSecret.headers as Record<string, string>)['x-leadstay-signature']).toMatch(/^sha256=/);
  });

  it('reports a rejecting endpoint instead of pretending it worked', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const result = await deliverAlert('https://x.test', buildAlertPayload(context()), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('never throws when the endpoint is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND hooks.example.com');
    });
    const result = await deliverAlert('https://x.test', buildAlertPayload(context()), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });

  it('reports a timeout in words the reader can act on', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    const result = await deliverAlert('https://x.test', buildAlertPayload(context()), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('The endpoint did not respond within 5 seconds.');
  });
});
