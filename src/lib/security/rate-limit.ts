/**
 * In-memory fixed-window rate limiter.
 *
 * Enough to blunt accidental floods and casual abuse on a single instance.
 * It is deliberately not a distributed limiter: with Redis configured, put a
 * shared limiter in front of this before relying on it in production.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size > MAX_TRACKED_KEYS) windows.clear();
    const window: Window = { count: 1, resetAt: now + windowMs };
    windows.set(key, window);
    return { allowed: true, remaining: limit - 1, resetAt: window.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export function clientKeyFrom(headers: Headers, fallback = 'unknown'): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || fallback;
  return headers.get('x-real-ip') ?? fallback;
}
