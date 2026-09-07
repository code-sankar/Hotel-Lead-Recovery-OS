import type { HotelKnowledge } from '@/lib/knowledge/types';

/**
 * Post-generation validation.
 *
 * The system prompt tells the model what it must not claim; this module checks
 * that it did not. Anything the model says about availability, bookings,
 * payments, discounts, prices or room names is verified against the trusted
 * hotel snapshot before it is allowed to reach a customer.
 *
 * A blocked reply is never silently "fixed" into a different factual claim —
 * it is replaced by the hotel's escalation message and the conversation is
 * flagged for a human.
 */

export type GuardrailFlag =
  | 'claimed_availability'
  | 'claimed_booking'
  | 'claimed_payment'
  | 'invented_discount'
  | 'invented_price'
  | 'invented_room'
  | 'empty_reply'
  | 'too_long';

export interface GuardrailResult {
  ok: boolean;
  flags: GuardrailFlag[];
  /** Text safe to send. Equals the escalation message when `ok` is false. */
  text: string;
  blocked: boolean;
}

/** Replies longer than this read as an essay on WhatsApp. */
const MAX_REPLY_CHARS = 900;

const HEDGE = /\b(?:confirm|check(?:ing)?|verify|subject to|need to|will let you know|team will|get back|not able to see|cannot see|don'?t have (?:live|real[- ]time))\b/i;

const AVAILABILITY_CLAIM = [
  /\b(?:yes|yeah|yep|sure|certainly)\b[^.!?]{0,60}\b(?:available|free|vacant|open)\b/i,
  /\b(?:we|i)\s+(?:have|do have|still have)\b[^.!?]{0,60}\b(?:available|free|vacant|open)\b/i,
  /\b(?:rooms?|suites?)\b[^.!?]{0,40}\b(?:is|are|remains?)\s+(?:available|free|vacant)\b/i,
  /\bi(?:'ve| have)\s+(?:blocked|held|reserved|kept)\b/i,
  /\b(?:it|that|this)\s+is\s+available\b/i,
];

const BOOKING_CLAIM = [
  /\byour (?:booking|reservation|room)\s+(?:is|has been)\s+(?:confirmed|booked|reserved)\b/i,
  /\bi(?:'ve| have)\s+(?:booked|reserved|confirmed)\b/i,
  /\bbooking (?:is )?(?:done|complete|confirmed)\b/i,
  /\byou(?:'re| are) (?:all )?(?:booked|confirmed)\b/i,
];

const PAYMENT_CLAIM = [
  /\bpayment\s+(?:is\s+)?(?:received|confirmed|successful|complete|done)\b/i,
  /\bwe(?:'ve| have)\s+received\s+your\s+payment\b/i,
  /\byour (?:advance|deposit) (?:is|has been) received\b/i,
];

const DISCOUNT_CLAIM = [
  /\b\d{1,2}\s*%\s*(?:off|discount)\b/i,
  /\b(?:special|discounted)\s+(?:rate|price|offer)\b/i,
  /\bi can (?:give|offer|do)\b[^.!?]{0,40}\b(?:discount|off|lower)\b/i,
  /\bcomplimentary\b/i,
];

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesUnhedged(text: string, patterns: RegExp[]): boolean {
  return sentences(text).some((sentence) => {
    if (!patterns.some((pattern) => pattern.test(sentence))) return false;
    return !HEDGE.test(sentence);
  });
}

/**
 * Money-like amounts: anything with a currency marker, or a bare number
 * presented as a nightly rate. Plain small numbers (times, guest counts,
 * night counts) are deliberately ignored.
 */
export function extractMoneyValues(text: string): number[] {
  const values = new Set<number>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    const value = Number(raw.replace(/[,\s]/g, ''));
    if (Number.isFinite(value) && value > 0) values.add(value);
  };

  for (const m of text.matchAll(/(?:₹|\brs\.?\s*|\binr\s*)([\d,]+(?:\.\d{1,2})?)/gi)) add(m[1]);
  for (const m of text.matchAll(
    /\b([\d,]{3,})\s*(?:\/-)?\s*(?:per\s+(?:night|day|room|person)|a\s+night|nightly)/gi,
  )) {
    add(m[1]);
  }
  return [...values];
}

function allowedMoneyValues(knowledge: HotelKnowledge, extraContext: string[]): Set<number> {
  const allowed = new Set<number>();
  for (const room of knowledge.rooms) {
    allowed.add(room.basePrice);
    // Multi-night and multi-room totals are arithmetic on trusted prices.
    for (let multiplier = 2; multiplier <= 14; multiplier += 1) {
      allowed.add(room.basePrice * multiplier);
    }
  }
  const textSources = [
    ...knowledge.policies.map((p) => p.content),
    ...knowledge.faqs.map((f) => `${f.question} ${f.answer}`),
    knowledge.profile.description ?? '',
    ...extraContext,
  ];
  for (const source of textSources) {
    for (const value of extractMoneyValues(source)) allowed.add(value);
  }
  return allowed;
}

function invalidRoomNames(text: string, knowledge: HotelKnowledge): string[] {
  const known = knowledge.rooms.map((room) => room.name.toLowerCase().trim());
  // Words that appear in a configured room name, so "Deluxe" is recognised even
  // when the model writes "Deluxe Suite" rather than "Deluxe Room".
  const knownWords = new Set(known.flatMap((name) => name.split(/\s+/)));
  const invalid: string[] = [];
  for (const match of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(Room|Suite)\b/g)) {
    const type = (match[2] ?? '').toLowerCase();
    const qualifierWords = (match[1] ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const lastWord = qualifierWords.at(-1) ?? '';
    const candidate = `${qualifierWords.join(' ')} ${type}`.trim();
    const isKnown =
      known.includes(candidate) ||
      known.includes(`${lastWord} ${type}`) ||
      qualifierWords.some((word) => knownWords.has(word));
    if (!isKnown) invalid.push(`${match[1]} ${match[2]}`);
  }
  return invalid;
}

export interface GuardrailInput {
  reply: string;
  knowledge: HotelKnowledge;
  /** Prior conversation text, so a price the customer quoted is not "invented". */
  conversationContext?: string[];
}

export function checkReply(input: GuardrailInput): { flags: GuardrailFlag[]; details: string[] } {
  const { reply, knowledge } = input;
  const flags: GuardrailFlag[] = [];
  const details: string[] = [];

  if (!reply || !reply.trim()) {
    return { flags: ['empty_reply'], details: ['model returned no text'] };
  }

  if (reply.length > MAX_REPLY_CHARS) {
    flags.push('too_long');
    details.push(`reply is ${reply.length} characters`);
  }

  if (matchesUnhedged(reply, AVAILABILITY_CLAIM)) {
    flags.push('claimed_availability');
    details.push('stated a room is available without deferring to the hotel team');
  }
  if (matchesUnhedged(reply, BOOKING_CLAIM)) {
    flags.push('claimed_booking');
    details.push('claimed a booking exists');
  }
  if (matchesUnhedged(reply, PAYMENT_CLAIM)) {
    flags.push('claimed_payment');
    details.push('claimed a payment was received');
  }
  if (DISCOUNT_CLAIM.some((pattern) => pattern.test(reply))) {
    flags.push('invented_discount');
    details.push('offered a discount that is not configured');
  }

  const allowed = allowedMoneyValues(knowledge, input.conversationContext ?? []);
  const quoted = extractMoneyValues(reply).filter((value) => !allowed.has(value));
  if (quoted.length > 0) {
    flags.push('invented_price');
    details.push(`quoted amount(s) not in hotel data: ${quoted.join(', ')}`);
  }

  const badRooms = invalidRoomNames(reply, knowledge);
  if (badRooms.length > 0) {
    flags.push('invented_room');
    details.push(`referenced unknown room type(s): ${badRooms.join(', ')}`);
  }

  return { flags, details };
}

/** Hard violations block the message; soft ones are recorded only. */
const BLOCKING_FLAGS: readonly GuardrailFlag[] = [
  'claimed_availability',
  'claimed_booking',
  'claimed_payment',
  'invented_discount',
  'invented_price',
  'invented_room',
  'empty_reply',
] as const;

export function enforceGuardrails(input: GuardrailInput): GuardrailResult {
  const { flags } = checkReply(input);
  const blocked = flags.some((flag) => BLOCKING_FLAGS.includes(flag));

  if (!blocked) {
    return { ok: true, flags, blocked: false, text: input.reply.trim() };
  }

  return {
    ok: false,
    flags,
    blocked: true,
    text: input.knowledge.settings.aiEscalationMessage,
  };
}
