import type { HotelKnowledge } from '@/lib/knowledge/types';
import { extractEntities } from './entities';

/**
 * Post-generation validation.
 *
 * The system prompt tells the model what it must not claim; this module checks
 * that it did not. Anything the model says about availability, bookings,
 * payments, discounts, prices or room names is verified against the trusted
 * hotel snapshot before it is allowed to reach a customer.
 *
 * Availability is the one claim whose rule changed when real inventory arrived.
 * It is no longer forbidden — it is VERIFIED. A positive availability claim is
 * allowed only when the application itself looked the dates up and the numbers
 * agree. With no lookup, or a lookup that disagrees, the claim is still blocked,
 * so the failure mode of a hotel that has not configured inventory is the old,
 * safe behaviour rather than a guess.
 *
 * A blocked reply is never silently "fixed" into a different factual claim —
 * it is replaced by the hotel's escalation message and the conversation is
 * flagged for a human.
 */

export type GuardrailFlag =
  /** Said a room is free without a verified lookup for those dates. */
  | 'unverified_availability'
  /** Said a room is free when the verified numbers say it is not. */
  | 'contradicts_availability'
  /** Said the hotel is full when the verified numbers say it is not. */
  | 'wrong_sold_out'
  | 'claimed_booking'
  | 'claimed_payment'
  | 'invented_discount'
  | 'invented_price'
  | 'invented_room'
  | 'empty_reply'
  | 'too_long';

/**
 * The result of an availability lookup the application performed for this turn.
 * Absent means no lookup happened, which is treated as "not verified".
 */
export interface AvailabilityContext {
  checkIn: string;
  checkOut: string;
  anyAvailable: boolean;
  availableRoomNames: string[];
  soldOutRoomNames: string[];
}

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

const SOLD_OUT_CLAIM = [
  /\b(?:fully booked|sold out|no (?:rooms?|availability)|nothing (?:available|free)|we are full|fully occupied)\b/i,
  /\b(?:rooms?|suites?)\b[^.!?]{0,30}\b(?:not available|unavailable)\b/i,
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

/**
 * Sentences split further on clause joiners, so "the Deluxe is free but the
 * Suite is fully booked" is judged as two separate claims rather than one
 * contradictory whole.
 */
function clauses(text: string): string[] {
  return sentences(text)
    .flatMap((sentence) => sentence.split(/(?:,?\s+\bbut\b\s+|;\s*|\s+\bhowever\b\s*,?\s*)/i))
    .map((clause) => clause.trim())
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

const DETERMINERS = new Set([
  'the', 'a', 'an', 'our', 'your', 'my', 'this', 'that', 'these', 'those', 'one', 'any', 'each',
]);

function invalidRoomNames(text: string, knowledge: HotelKnowledge): string[] {
  const known = knowledge.rooms.map((room) => room.name.toLowerCase().trim());
  // Words that appear in a configured room name, so "Deluxe" is recognised even
  // when the model writes "Deluxe Suite" rather than "Deluxe Room".
  const knownWords = new Set(known.flatMap((name) => name.split(/\s+/)));
  const invalid: string[] = [];
  for (const match of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(Room|Suite)\b/g)) {
    const type = (match[2] ?? '').toLowerCase();
    // "The Suite" names the room type "Suite"; the article is not part of it.
    const qualifierWords = (match[1] ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word && !DETERMINERS.has(word));
    const lastWord = qualifierWords.at(-1) ?? '';
    const candidate = `${qualifierWords.join(' ')} ${type}`.trim();
    const isKnown =
      known.includes(candidate) ||
      (lastWord !== '' && known.includes(`${lastWord} ${type}`)) ||
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
  /**
   * The lookup the application ran for this turn. Omit it and every positive
   * availability claim is blocked, which is the correct default.
   */
  availability?: AvailabilityContext | null;
}

/**
 * Checks availability statements against the verified numbers.
 *
 * Judged per clause, so a reply may truthfully say one room is free and another
 * is not. Hedged statements ("I'll confirm with the team") are always allowed —
 * deferring to a human is never a false claim.
 */
function checkAvailabilityClaims(
  reply: string,
  knowledge: HotelKnowledge,
  availability: AvailabilityContext | null | undefined,
): { flags: GuardrailFlag[]; details: string[] } {
  const flags: GuardrailFlag[] = [];
  const details: string[] = [];

  const roomNames = knowledge.rooms.map((room) => room.name);
  const availableSet = new Set((availability?.availableRoomNames ?? []).map((n) => n.toLowerCase()));

  const mentionedRooms = (clause: string) =>
    roomNames.filter((name) => clause.toLowerCase().includes(name.toLowerCase()));

  for (const clause of clauses(reply)) {
    if (HEDGE.test(clause)) continue;

    const claimsAvailable = AVAILABILITY_CLAIM.some((pattern) => pattern.test(clause));
    const claimsSoldOut = SOLD_OUT_CLAIM.some((pattern) => pattern.test(clause));

    if (claimsAvailable) {
      if (!availability) {
        flags.push('unverified_availability');
        details.push(`said a room is available with no verified lookup: "${clause}"`);
        continue;
      }
      if (!availability.anyAvailable) {
        flags.push('contradicts_availability');
        details.push(`said a room is available, but nothing is free for ${availability.checkIn} to ${availability.checkOut}`);
        continue;
      }
      const named = mentionedRooms(clause);
      const wrong = named.filter((name) => !availableSet.has(name.toLowerCase()));
      if (wrong.length > 0) {
        flags.push('contradicts_availability');
        details.push(`said ${wrong.join(', ')} is available, but it is not free for those dates`);
        continue;
      }
      // A claim about dates the application did not check is not verified.
      const claimedDate = extractEntities(clause).checkIn;
      if (claimedDate && (claimedDate < availability.checkIn || claimedDate >= availability.checkOut)) {
        flags.push('unverified_availability');
        details.push(`claimed availability for ${claimedDate}, which is outside the checked range ${availability.checkIn}–${availability.checkOut}`);
      }
      continue;
    }

    if (claimsSoldOut && availability) {
      const named = mentionedRooms(clause);
      // Wrongly telling a guest the hotel is full loses the booking outright,
      // so it is treated as seriously as inventing availability.
      const wronglyFull = named.filter((name) => availableSet.has(name.toLowerCase()));
      if (wronglyFull.length > 0) {
        flags.push('wrong_sold_out');
        details.push(`said ${wronglyFull.join(', ')} is unavailable, but it is free for those dates`);
      } else if (named.length === 0 && availability.anyAvailable) {
        flags.push('wrong_sold_out');
        details.push('said the hotel is full, but rooms are free for those dates');
      }
    }
  }

  return { flags: [...new Set(flags)], details };
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

  const availabilityCheck = checkAvailabilityClaims(reply, knowledge, input.availability);
  flags.push(...availabilityCheck.flags);
  details.push(...availabilityCheck.details);

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
  'unverified_availability',
  'contradicts_availability',
  'wrong_sold_out',
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
