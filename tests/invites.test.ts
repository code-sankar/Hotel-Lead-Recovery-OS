import { describe, expect, it } from 'vitest';
import {
  INVITE_TOKEN_LENGTH,
  generateInviteToken,
  hashInviteToken,
  inviteExpiryFrom,
  inviteUrl,
  isWellFormedInviteToken,
} from '@/lib/team/tokens';

/**
 * The invite token is the whole security boundary for joining a hotel, so its
 * shape, its hashing and its lifetime are pinned down.
 */

describe('invite tokens', () => {
  it('generates a long, hex-only token', () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(INVITE_TOKEN_LENGTH);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('never generates the same token twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateInviteToken()));
    expect(tokens.size).toBe(500);
  });

  it('hashes deterministically, and differently for different tokens', () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(generateInviteToken()));
  });

  it('produces a hash that is not the token itself', () => {
    const token = generateInviteToken();
    // What reaches the database must never be redeemable as a link.
    expect(hashInviteToken(token)).not.toBe(token);
  });

  it('rejects anything that is not token-shaped', () => {
    expect(isWellFormedInviteToken(generateInviteToken())).toBe(true);
    expect(isWellFormedInviteToken('short')).toBe(false);
    expect(isWellFormedInviteToken('z'.repeat(INVITE_TOKEN_LENGTH))).toBe(false);
    expect(isWellFormedInviteToken(`${generateInviteToken()}extra`)).toBe(false);
    expect(isWellFormedInviteToken(null)).toBe(false);
    expect(isWellFormedInviteToken(undefined)).toBe(false);
    expect(isWellFormedInviteToken("' or 1=1 --")).toBe(false);
  });

  it('expires a week out by default', () => {
    const now = new Date('2026-09-15T10:00:00Z');
    expect(inviteExpiryFrom(now).toISOString()).toBe('2026-09-22T10:00:00.000Z');
    expect(inviteExpiryFrom(now, 1).toISOString()).toBe('2026-09-16T10:00:00.000Z');
  });

  it('builds a link without doubling the slash', () => {
    expect(inviteUrl('https://app.example.com', 'abc')).toBe('https://app.example.com/invite/abc');
    expect(inviteUrl('https://app.example.com/', 'abc')).toBe('https://app.example.com/invite/abc');
  });
});
