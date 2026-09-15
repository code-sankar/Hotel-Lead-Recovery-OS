import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Invite tokens.
 *
 * The plaintext token exists only in the link the owner shares. The database
 * stores its SHA-256 hash, so a leaked row cannot be redeemed and the token
 * never appears in Postgres logs. Hashing happens here rather than in SQL,
 * which also avoids depending on which schema pgcrypto lives in.
 */

/** 32 bytes of entropy, hex encoded. Long enough that guessing is hopeless. */
export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TOKEN_LENGTH = INVITE_TOKEN_BYTES * 2;

/** Invitations are short-lived; a stale link in a WhatsApp thread should die. */
export const INVITE_TTL_DAYS = 7;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Rejects anything that is not a token-shaped string before it reaches the database. */
export function isWellFormedInviteToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && new RegExp(`^[0-9a-f]{${INVITE_TOKEN_LENGTH}}$`).test(token);
}

export function inviteExpiryFrom(now: Date = new Date(), days = INVITE_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function inviteUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite/${token}`;
}

/** Constant-time comparison, for anywhere two hashes are checked in app code. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
