import type { LeadIntent } from '@/types/domain';

/**
 * Deterministic intent classifier.
 *
 * Used as the classifier in rule-based mode, and as a cross-check on model
 * output: if the model returns an intent the parser cannot corroborate, the
 * pipeline still has a defensible label to store and score against.
 */

interface IntentRule {
  intent: LeadIntent;
  patterns: RegExp[];
}

/** Ordered by escalation priority first, then by commercial specificity. */
const RULES: IntentRule[] = [
  {
    intent: 'human_help',
    patterns: [
      /\b(?:talk|speak|connect)\s+(?:to|with)\s+(?:a\s+)?(?:human|person|someone|manager|staff|agent|owner)\b/i,
      /\breal person\b/i,
      /\bcall me\b/i,
      /\bcustomer care\b/i,
      /\bare you (?:a )?(?:bot|ai|robot)\b/i,
    ],
  },
  {
    intent: 'complaint',
    patterns: [
      /\bcomplain(t|ing)?\b/i,
      /\brefund\b/i,
      /\b(?:very )?(?:bad|poor|terrible|worst|horrible)\s+(?:service|experience|room|stay)\b/i,
      /\b(?:dirty|filthy|unhygienic)\b/i,
      /\bnot happy\b/i,
      /\bissue with (?:my|the) (?:room|stay|booking)\b/i,
    ],
  },
  {
    intent: 'payment',
    patterns: [
      /\bpayment\b/i,
      /\bpay(?:ing|ed)?\b/i,
      /\bupi\b/i,
      /\bgpay\b|\bpaytm\b|\bphonepe\b/i,
      /\badvance\b/i,
      /\bbank (?:transfer|details|account)\b/i,
      /\bdeposit\b/i,
      /\bcard\b/i,
    ],
  },
  {
    intent: 'cancellation',
    patterns: [/\bcancel(?:lation|led|ling)?\b/i, /\brefund policy\b/i, /\breschedul/i],
  },
  {
    intent: 'group_booking',
    patterns: [
      /\bgroup\b/i,
      /\b(?:[5-9]|[1-9]\d)\s*(?:rooms?|persons?|people|guests?|pax)\b/i,
      /\bbulk booking\b/i,
      /\bcorporate (?:booking|rate)\b/i,
    ],
  },
  {
    intent: 'event_or_conference',
    patterns: [
      /\bconference\b/i,
      /\bbanquet\b/i,
      /\bwedding\b/i,
      /\bevent\b/i,
      /\bmeeting room\b/i,
      /\bparty\b/i,
      /\bhall\b/i,
    ],
  },
  {
    intent: 'discount_request',
    patterns: [
      /\bdiscount\b/i,
      /\bbest (?:price|rate|deal)\b/i,
      /\bany offer\b/i,
      /\bcheaper\b/i,
      /\bkam (?:karo|hoga)\b/i,
      /\blast price\b/i,
      /\bnegotiat/i,
    ],
  },
  {
    intent: 'airport_transfer',
    patterns: [/\bairport\b/i, /\bpick ?up\b/i, /\bdrop\b/i, /\bcab\b/i, /\btaxi\b/i, /\btransfer\b/i],
  },
  {
    intent: 'booking_intent',
    patterns: [
      /\bbook (?:it|this|the room|a room|now)\b/i,
      /\bi (?:want|need|would like) to book\b/i,
      /\bplease book\b/i,
      /\bconfirm (?:my |the )?(?:booking|room|reservation)\b/i,
      /\breserve\b/i,
      /\bgo ahead\b/i,
      /\bkar do\b/i,
      /\bfinali[sz]e\b/i,
    ],
  },
  {
    intent: 'room_availability',
    patterns: [
      /\bavailab(?:le|ility)\b/i,
      /\bvacan(?:t|cy)\b/i,
      /\bany rooms?\b/i,
      /\brooms?\s+(?:free|open|left)\b/i,
      /\brooms?\s+for\b/i,
      /\broom hai\b/i,
      /\bkhali\b/i,
      /\bdo you have\b[^?]*\brooms?\b/i,
    ],
  },
  {
    intent: 'pricing',
    patterns: [
      /\bprice\b/i,
      /\brates?\b/i,
      /\bcost\b/i,
      /\bcharges?\b/i,
      /\btariff\b/i,
      /\bhow much\b/i,
      /\bkitna\b/i,
      /\bper night\b/i,
    ],
  },
  {
    intent: 'restaurant_or_food',
    patterns: [/\brestaurant\b/i, /\bfood\b/i, /\bdinner\b/i, /\blunch\b/i, /\bmenu\b/i, /\bkitchen\b/i],
  },
  {
    intent: 'check_in_out',
    patterns: [
      /\bcheck[- ]?in\b/i,
      /\bcheck[- ]?out\b/i,
      /\bearly (?:arrival|check)/i,
      /\blate (?:checkout|check)/i,
    ],
  },
  {
    intent: 'amenities',
    patterns: [
      /\bwi-?fi\b/i,
      /\bbreakfast\b/i,
      /\bparking\b/i,
      /\bac\b|\bair ?condition/i,
      /\bpool\b/i,
      /\bgym\b/i,
      /\blift\b|\belevator\b/i,
      /\bgeyser\b|\bhot water\b/i,
      /\bamenit/i,
    ],
  },
  {
    intent: 'location',
    patterns: [
      /\blocation\b/i,
      /\baddress\b/i,
      /\bwhere (?:is|are) (?:you|the hotel|it)\b/i,
      /\bhow far\b/i,
      /\bdistance\b/i,
      /\bkahan\b/i,
      /\bdirections?\b/i,
      /\bmap\b/i,
    ],
  },
  {
    intent: 'room_information',
    patterns: [
      /\broom (?:types?|options?|details?|size)\b/i,
      /\bdeluxe\b/i,
      /\bsuite\b/i,
      /\bexecutive\b/i,
      /\bwhat (?:kind|type)s? of rooms?\b/i,
    ],
  },
  {
    intent: 'hotel_information',
    patterns: [/\babout (?:the |your )?hotel\b/i, /\bhotel (?:details|info)/i, /\bphotos?\b/i, /\bstar\b/i],
  },
];

export interface IntentClassification {
  intent: LeadIntent;
  confidence: number;
  matched: LeadIntent[];
}

/**
 * Confidence reflects how cleanly the text matched: a single unambiguous rule
 * scores higher than a message that triggered several competing rules.
 */
export function classifyIntent(text: string): IntentClassification {
  if (!text?.trim()) return { intent: 'unknown', confidence: 0, matched: [] };

  const matched: LeadIntent[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) matched.push(rule.intent);
  }

  if (matched.length === 0) return { intent: 'unknown', confidence: 0.2, matched };

  const intent = matched[0] as LeadIntent;
  const confidence = matched.length === 1 ? 0.85 : Math.max(0.5, 0.85 - (matched.length - 1) * 0.08);
  return { intent, confidence: Number(confidence.toFixed(2)), matched };
}

/** Intents where a human must always be looped in. */
export const ESCALATION_INTENTS: readonly LeadIntent[] = [
  'complaint',
  'human_help',
  'payment',
] as const;

export function intentRequiresHuman(intent: LeadIntent): boolean {
  return ESCALATION_INTENTS.includes(intent);
}

/** Intents that represent a live commercial enquiry worth chasing. */
export const QUALIFYING_INTENTS: readonly LeadIntent[] = [
  'room_availability',
  'pricing',
  'booking_intent',
  'room_information',
  'discount_request',
  'group_booking',
  'event_or_conference',
  'check_in_out',
  'amenities',
  'airport_transfer',
] as const;

export function isQualifyingIntent(intent: LeadIntent): boolean {
  return QUALIFYING_INTENTS.includes(intent);
}

export const INTENT_LABELS: Record<LeadIntent, string> = {
  room_availability: 'Availability',
  pricing: 'Pricing',
  booking_intent: 'Booking intent',
  room_information: 'Room information',
  hotel_information: 'Hotel information',
  amenities: 'Amenities',
  location: 'Location',
  check_in_out: 'Check-in / out',
  cancellation: 'Cancellation',
  payment: 'Payment',
  discount_request: 'Discount request',
  group_booking: 'Group booking',
  event_or_conference: 'Event / conference',
  airport_transfer: 'Airport transfer',
  restaurant_or_food: 'Restaurant / food',
  complaint: 'Complaint',
  human_help: 'Wants a human',
  unknown: 'Unknown',
};

/** Detects an explicit opt-out so the follow-up engine can stop permanently. */
export function isOptOut(text: string): boolean {
  return [
    /\bstop\b/i,
    /\bunsubscribe\b/i,
    /\bdon'?t (?:message|contact|disturb)\b/i,
    /\bremove me\b/i,
    /\bno more messages\b/i,
  ].some((pattern) => pattern.test(text));
}
