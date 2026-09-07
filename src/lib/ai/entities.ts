/**
 * Deterministic extraction of booking entities from free-text WhatsApp
 * messages. Runs before (and independently of) the language model so that
 * dates and guest counts driving lead scoring never depend on model output.
 * The model may add to these; it may not overwrite a confident local match.
 */

export interface BookingEntities {
  checkIn?: string; // ISO date (YYYY-MM-DD)
  checkOut?: string;
  guests?: number;
  nights?: number;
  roomPreference?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const ROOM_KEYWORDS = ['deluxe', 'executive', 'suite', 'standard', 'family', 'twin', 'double', 'single'];

function toIso(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves a day/month pair to the next occurrence, so "15 Sept" asked in
 * October means next year rather than a date in the past.
 */
function resolveYear(day: number, month: number, now: Date): number {
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return candidate < today ? year + 1 : year;
}

function extractDates(text: string, now: Date): string[] {
  const found: string[] = [];
  const push = (iso: string | undefined) => {
    if (iso && !found.includes(iso)) found.push(iso);
  };

  // ISO: 2026-09-15
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(toIso(Number(m[1]), Number(m[2]), Number(m[3])));
  }

  // 15 Sept / 15th September / Sept 15
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/gi,
  )) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    const day = Number(m[1]);
    if (month) push(toIso(resolveYear(day, month, now), month, day));
  }
  for (const m of text.matchAll(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi)) {
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    const day = Number(m[2]);
    if (month) push(toIso(resolveYear(day, month, now), month, day));
  }

  // dd/mm or dd/mm/yyyy — Indian day-first convention
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const rawYear = m[3];
    const year = rawYear
      ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
      : resolveYear(day, month, now);
    push(toIso(year, month, day));
  }

  if (/\btonight\b|\btoday\b|\baaj\b/i.test(text)) push(addDays(now, 0));
  if (/\btomorrow\b|\bkal\b/i.test(text)) push(addDays(now, 1));
  if (/\bday after tomorrow\b|\bparso\b/i.test(text)) push(addDays(now, 2));
  if (/\bthis weekend\b/i.test(text)) {
    const daysUntilSaturday = (6 - now.getUTCDay() + 7) % 7;
    push(addDays(now, daysUntilSaturday));
  }

  return found.sort();
}

function extractGuests(text: string): number | undefined {
  const patterns: RegExp[] = [
    /\b(\d{1,2})\s*(?:adults?|guests?|persons?|people|pax|ppl)\b/i,
    /\bfor\s+(\d{1,2})\s*(?:adults?|guests?|persons?|people|pax)?\b/i,
    /\b(\d{1,2})\s*(?:log|jane|vyakti)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (value >= 1 && value <= 30) return value;
    }
  }
  // A bare number is only a guest count when it is the whole message ("2").
  const bare = text.trim().match(/^(\d{1,2})$/);
  if (bare?.[1]) {
    const value = Number(bare[1]);
    if (value >= 1 && value <= 20) return value;
  }
  return undefined;
}

function extractNights(text: string): number | undefined {
  const match = text.match(/\b(\d{1,2})\s*(?:nights?|raat)\b/i);
  if (match?.[1]) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 60) return value;
  }
  return undefined;
}

function extractRoomPreference(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hit = ROOM_KEYWORDS.find((keyword) => lower.includes(keyword));
  return hit ? hit.charAt(0).toUpperCase() + hit.slice(1) : undefined;
}

export function extractEntities(text: string, now: Date = new Date()): BookingEntities {
  if (!text?.trim()) return {};

  const entities: BookingEntities = {};
  const dates = extractDates(text, now);
  if (dates[0]) entities.checkIn = dates[0];
  if (dates[1]) entities.checkOut = dates[1];

  const guests = extractGuests(text);
  if (guests !== undefined) entities.guests = guests;

  const nights = extractNights(text);
  if (nights !== undefined) entities.nights = nights;

  const room = extractRoomPreference(text);
  if (room !== undefined) entities.roomPreference = room;

  // A single date plus a night count implies the checkout date.
  if (entities.checkIn && !entities.checkOut && entities.nights) {
    const start = new Date(`${entities.checkIn}T00:00:00Z`);
    entities.checkOut = addDays(start, entities.nights);
  }

  return entities;
}

/** Later extractions win only where they add information. */
export function mergeEntities(base: BookingEntities, incoming: BookingEntities): BookingEntities {
  return {
    checkIn: incoming.checkIn ?? base.checkIn,
    checkOut: incoming.checkOut ?? base.checkOut,
    guests: incoming.guests ?? base.guests,
    nights: incoming.nights ?? base.nights,
    roomPreference: incoming.roomPreference ?? base.roomPreference,
  };
}
