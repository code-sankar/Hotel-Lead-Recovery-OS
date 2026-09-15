import { createHash } from 'node:crypto';

/**
 * Event fingerprinting.
 *
 * A provider outage that fails two thousand times should be one row saying
 * "2000", not two thousand rows nobody will read. Messages are normalised so
 * that the same failure with different ids, numbers or URLs collapses onto one
 * fingerprint, while genuinely different failures stay apart.
 */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const URL = /\bhttps?:\/\/\S+/gi;
const QUOTED = /(["'`])(?:(?!\1).){1,120}\1/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
/** WhatsApp message ids, which appear in almost every provider error. */
const WAMID = /\bwamid\.[A-Za-z0-9_=-]+/gi;

export function normaliseMessage(message: string): string {
  return message
    .replace(UUID, '<id>')
    .replace(WAMID, '<wamid>')
    .replace(URL, '<url>')
    .replace(LONG_HEX, '<hex>')
    .replace(QUOTED, '<value>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Stable across processes and restarts, so counting works over time. */
export function fingerprintOf(scope: string, message: string): string {
  return createHash('sha256')
    .update(`${scope}|${normaliseMessage(message)}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

export function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
