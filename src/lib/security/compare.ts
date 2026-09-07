import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Hashing first keeps the comparison
 * constant-time even when the two values differ in length.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false;
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}
