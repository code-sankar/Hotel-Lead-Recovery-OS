import { describe, expect, it } from 'vitest';
import { fingerprintOf, messageFrom, normaliseMessage } from '@/lib/monitoring/fingerprint';
import { buildEvent } from '@/lib/monitoring/logger';

/**
 * Fingerprinting decides whether the health page is readable or a flood, so the
 * collapsing rules are pinned down: the same failure with different ids must
 * collapse, and genuinely different failures must not.
 */

describe('normaliseMessage', () => {
  it('strips ids, numbers, urls and quoted values', () => {
    expect(normaliseMessage('lead 3f2504e0-4f89-41d3-9a0c-0305e82c3301 not found')).toBe(
      'lead <id> not found',
    );
    expect(normaliseMessage('failed after 37 attempts')).toBe('failed after <n> attempts');
    expect(normaliseMessage('POST https://graph.facebook.com/v21.0/x failed')).toBe(
      'POST <url> failed',
    );
    expect(normaliseMessage('template "leadstay_follow_up_1" not approved')).toBe(
      'template <value> not approved',
    );
    expect(normaliseMessage('message wamid.HBgMOTE5ODEwMDAwMTAx failed')).toBe(
      'message <wamid> failed',
    );
  });

  it('collapses whitespace and caps length', () => {
    expect(normaliseMessage('  too    many   spaces  ')).toBe('too many spaces');
    expect(normaliseMessage('x'.repeat(500))).toHaveLength(300);
  });
});

describe('fingerprintOf', () => {
  it('collapses the same failure with different ids onto one fingerprint', () => {
    const a = fingerprintOf('followup.send', 'follow-up 3f2504e0-4f89-41d3-9a0c-0305e82c3301 failed');
    const b = fingerprintOf('followup.send', 'follow-up 9c858901-8a57-4791-81fe-4c455b099bc9 failed');
    expect(a).toBe(b);
  });

  it('keeps genuinely different failures apart', () => {
    expect(fingerprintOf('followup.send', 'template not approved')).not.toBe(
      fingerprintOf('followup.send', 'access token expired'),
    );
  });

  it('keeps the same message in different scopes apart', () => {
    expect(fingerprintOf('whatsapp.webhook', 'timeout')).not.toBe(
      fingerprintOf('followup.send', 'timeout'),
    );
  });

  it('is stable across calls, so counting works over time', () => {
    expect(fingerprintOf('a', 'b')).toBe(fingerprintOf('a', 'b'));
  });
});

describe('messageFrom', () => {
  it('reads Error, string and object shapes', () => {
    expect(messageFrom(new Error('boom'))).toBe('boom');
    expect(messageFrom('plain')).toBe('plain');
    expect(messageFrom({ code: 42 })).toBe('{"code":42}');
  });

  it('falls back to the error name when the message is empty', () => {
    expect(messageFrom(new Error(''))).toBe('Error');
  });

  it('survives something that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(typeof messageFrom(circular)).toBe('string');
  });
});

describe('buildEvent', () => {
  it('captures the error name and a trimmed stack', () => {
    const event = buildEvent('error', { scope: 'job.x', error: new Error('boom') });
    expect(event.level).toBe('error');
    expect(event.message).toBe('boom');
    expect(event.detail.name).toBe('Error');
    expect(String(event.detail.stack).split('\n').length).toBeLessThanOrEqual(4);
  });

  it('keeps an explicit message and records the underlying error as the cause', () => {
    const event = buildEvent('error', {
      scope: 'followup.send',
      error: new Error('429 too many requests'),
      message: 'A follow-up could not be sent.',
    });
    expect(event.message).toBe('A follow-up could not be sent.');
    expect(event.detail.cause).toBe('429 too many requests');
  });

  it('carries caller detail through', () => {
    const event = buildEvent('warning', {
      scope: 'ai.guardrail',
      message: 'blocked',
      detail: { flags: ['contradicts_availability'] },
      businessId: 'biz-1',
    });
    expect(event.businessId).toBe('biz-1');
    expect(event.detail.flags).toEqual(['contradicts_availability']);
  });

  it('treats a missing tenant as console-only rather than guessing one', () => {
    expect(buildEvent('error', { scope: 'x', message: 'y' }).businessId).toBeNull();
  });

  it('caps a very long message so one failure cannot fill the table', () => {
    const event = buildEvent('error', { scope: 'x', message: 'y'.repeat(5000) });
    expect(event.message).toHaveLength(2000);
  });
});
