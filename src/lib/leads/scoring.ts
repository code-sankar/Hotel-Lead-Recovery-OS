import type { LeadTemperature } from '@/types/domain';

/**
 * Deterministic lead scoring.
 *
 * The score is intentionally NOT produced by the language model. The model
 * classifies intent and writes prose; the pipeline value that drives follow-ups
 * and the hot/warm/cold pipeline is computed here from observable signals, so
 * it is reproducible, explainable to a hotel owner, and testable.
 *
 * Signals are a SET, not a stream: the pipeline re-derives them from the
 * conversation each time, so re-processing a message can never inflate a score.
 * This module is deliberately free of I/O so it can later be swapped for a
 * data-driven model behind the same interface.
 */

export type LeadSignal =
  | 'asked_availability'
  | 'provided_dates'
  | 'provided_guests'
  | 'asked_price'
  | 'asked_to_book'
  | 'asked_payment'
  | 'asked_room_options'
  | 'asked_location'
  | 'just_checking'
  | 'comparing_hotels'
  | 'inactive'
  | 'not_interested';

export const SIGNAL_WEIGHTS: Record<LeadSignal, number> = {
  asked_availability: 20,
  provided_dates: 15,
  provided_guests: 15,
  asked_price: 10,
  asked_to_book: 20,
  asked_payment: 20,
  asked_room_options: 10,
  asked_location: 5,
  just_checking: -10,
  comparing_hotels: -10,
  inactive: -10,
  not_interested: -20,
};

export const SIGNAL_LABELS: Record<LeadSignal, string> = {
  asked_availability: 'Asked about availability',
  provided_dates: 'Gave travel dates',
  provided_guests: 'Gave guest count',
  asked_price: 'Asked about price',
  asked_to_book: 'Asked to book',
  asked_payment: 'Asked about payment',
  asked_room_options: 'Asked about room options',
  asked_location: 'Asked about location',
  just_checking: 'Said they are just checking',
  comparing_hotels: 'Comparing other hotels',
  inactive: 'Went quiet',
  not_interested: 'Said they are not interested',
};

export const MAX_SCORE = 100;
export const MIN_SCORE = 0;

/**
 * A guest who asks to book, or asks how to pay, is a hot lead however few of
 * the other questions they happened to ask. Rather than distort the individual
 * weights, that is expressed as a floor on the final score.
 */
export const HOT_FLOOR = 80;
const HOT_FLOOR_SIGNALS: readonly LeadSignal[] = ['asked_to_book', 'asked_payment'] as const;

/** Minutes of customer silence after which the `inactive` penalty applies. */
export const INACTIVITY_THRESHOLD_MINUTES = 24 * 60;

interface Matcher {
  signal: LeadSignal;
  patterns: RegExp[];
}

/**
 * Phrase matchers cover plain English plus the romanised Hindi/Hinglish that
 * Indian hotel enquiries arrive in ("room hai?", "price kya hai", "2 person").
 */
const MATCHERS: Matcher[] = [
  {
    signal: 'asked_availability',
    patterns: [
      /\bavailab(le|ility)\b/i,
      /\bany\s+rooms?\b/i,
      /\broom\s+(hai|available)\b/i,
      /\bkhali\s+hai\b/i,
      /\bdo you have\b.*\brooms?\b/i,
      /\bvacancy\b/i,
      /\bcan i (get|have)\b.*\brooms?\b/i,
    ],
  },
  {
    signal: 'asked_price',
    patterns: [
      /\bprice\b/i,
      /\brate(s)?\b/i,
      /\bcost\b/i,
      /\bcharges?\b/i,
      /\btariff\b/i,
      /\bhow much\b/i,
      /\bkitna\b/i,
      /\bkya\s+(rate|price)\b/i,
      /\bper night\b/i,
      /₹|\brs\.?\b/i,
    ],
  },
  {
    signal: 'asked_to_book',
    patterns: [
      /\bbook(ing)?\b(?!.*\bengine\b)/i,
      /\breserve\b/i,
      /\breservation\b/i,
      /\bconfirm\b.*\b(room|stay|booking)\b/i,
      /\bi(?:'| a)?m taking it\b/i,
      /\bgo ahead\b/i,
      /\bfinalize\b/i,
      /\bkar do\b/i,
    ],
  },
  {
    signal: 'asked_payment',
    patterns: [
      /\bpay(ment)?\b/i,
      /\badvance\b/i,
      /\bupi\b/i,
      /\bgpay\b/i,
      /\bpaytm\b/i,
      /\bcard\b/i,
      /\bbank (transfer|details)\b/i,
      /\bpayment link\b/i,
      /\bdeposit\b/i,
    ],
  },
  {
    signal: 'asked_room_options',
    patterns: [
      /\broom types?\b/i,
      /\bwhat (kind|type|sort)s? of rooms?\b/i,
      /\bdeluxe\b/i,
      /\bsuite\b/i,
      /\bexecutive\b/i,
      /\boptions?\b/i,
      /\bkaun se room\b/i,
    ],
  },
  {
    signal: 'asked_location',
    patterns: [
      /\blocation\b/i,
      /\baddress\b/i,
      /\bwhere (is|are) (you|the hotel)\b/i,
      /\bhow far\b/i,
      /\bdistance\b/i,
      /\bkahan\b/i,
      /\bnear\b/i,
      /\bdirections?\b/i,
    ],
  },
  {
    signal: 'just_checking',
    patterns: [
      /\bjust (checking|asking|enquir(y|ing)|browsing|looking)\b/i,
      /\bonly (checking|asking)\b/i,
      /\bkeep (me|it) (posted|in mind)\b/i,
      /\bfor (now|later) (only|just)\b/i,
    ],
  },
  {
    signal: 'comparing_hotels',
    patterns: [
      /\bcompar(e|ing)\b/i,
      /\bother hotels?\b/i,
      /\bchecking (a )?few (places|hotels|options)\b/i,
      /\bquotes? from\b/i,
      /\bbooking\.com|makemytrip|goibibo|agoda|oyo\b/i,
    ],
  },
  {
    signal: 'not_interested',
    patterns: [
      /\bnot interested\b/i,
      /\bno longer\b.*\b(need|interested|looking)\b/i,
      /\bcancel (my )?(enquiry|plan)\b/i,
      /\bbooked (somewhere|elsewhere|another)\b/i,
      /\bplan (is )?cancell?ed\b/i,
      /\bdon'?t (contact|message|disturb)\b/i,
      /\bstop (messaging|sending)\b/i,
      /\bunsubscribe\b/i,
    ],
  },
];

/** Signals detectable from a single customer message. */
export function detectSignals(text: string): LeadSignal[] {
  if (!text || !text.trim()) return [];
  const found = new Set<LeadSignal>();
  for (const matcher of MATCHERS) {
    if (matcher.patterns.some((p) => p.test(text))) found.add(matcher.signal);
  }
  return [...found];
}

export interface ScoreBreakdownEntry {
  signal: LeadSignal;
  label: string;
  weight: number;
}

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
  signals: LeadSignal[];
  breakdown: ScoreBreakdownEntry[];
}

/** Sums unique signal weights and clamps into the 0–100 reporting range. */
export function scoreFromSignals(signals: Iterable<LeadSignal>): LeadScoreResult {
  const unique = [...new Set(signals)];
  const breakdown = unique.map((signal) => ({
    signal,
    label: SIGNAL_LABELS[signal],
    weight: SIGNAL_WEIGHTS[signal],
  }));
  const raw = breakdown.reduce((total, entry) => total + entry.weight, 0);
  const withdrawn = unique.includes('not_interested');
  const floored =
    !withdrawn && unique.some((signal) => HOT_FLOOR_SIGNALS.includes(signal))
      ? Math.max(raw, HOT_FLOOR)
      : raw;
  const score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, floored));
  return { score, temperature: temperatureForScore(score), signals: unique, breakdown };
}

export function temperatureForScore(score: number): LeadTemperature {
  if (score >= 80) return 'hot';
  if (score >= 50) return 'warm';
  if (score >= 20) return 'cold';
  return 'low';
}

export interface ScoreInputs {
  /** Every customer message in the conversation, oldest first. */
  customerMessages: string[];
  /** Booking entities the pipeline has already confirmed for this lead. */
  entities?: {
    checkIn?: string | null;
    checkOut?: string | null;
    guests?: number | null;
  };
  /** Minutes since the customer last wrote, if known. */
  minutesSinceLastCustomerMessage?: number | null;
}

/**
 * Derives the full signal set for a lead from its conversation history.
 * Date/guest signals come from confirmed entities rather than phrasing, so
 * "2" on its own still counts once the pipeline has stored guests = 2.
 */
export function deriveLeadScore(inputs: ScoreInputs): LeadScoreResult {
  const signals = new Set<LeadSignal>();

  for (const message of inputs.customerMessages) {
    for (const signal of detectSignals(message)) signals.add(signal);
  }

  if (inputs.entities?.checkIn || inputs.entities?.checkOut) signals.add('provided_dates');
  if (typeof inputs.entities?.guests === 'number' && inputs.entities.guests > 0) {
    signals.add('provided_guests');
  }

  const idle = inputs.minutesSinceLastCustomerMessage;
  if (typeof idle === 'number' && idle >= INACTIVITY_THRESHOLD_MINUTES) {
    signals.add('inactive');
  }

  return scoreFromSignals(signals);
}
