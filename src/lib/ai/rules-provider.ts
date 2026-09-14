import type { LeadTemperature } from '@/types/domain';
import type { HotelKnowledge, KnowledgeFaq, KnowledgeRoom } from '@/lib/knowledge/types';
import { describeRoom, formatMoney } from '@/lib/knowledge/format';
import { classifyIntent, intentRequiresHuman, isOptOut, isQualifyingIntent } from './intent';
import { extractEntities } from './entities';
import type {
  AiAnalysis,
  AiProvider,
  AiToolCall,
  AnalyzeInput,
  ReplyInput,
  ReplyOutput,
  SuggestedAction,
} from './types';

/**
 * Deterministic, rule-based conversation engine.
 *
 * This is NOT a stand-in that pretends to be a language model: it is a real
 * fallback that answers from the same trusted hotel data, and every message it
 * produces is stamped `rules-v1` in the database and labelled in the UI. It
 * keeps demo mode and local development fully functional without an OpenAI
 * key, and it is what the app degrades to if the OpenAI call fails.
 */

const STOPWORDS = new Set([
  'the', 'is', 'are', 'a', 'an', 'do', 'you', 'have', 'any', 'for', 'and', 'of', 'to', 'in', 'on',
  'at', 'it', 'i', 'we', 'my', 'me', 'can', 'will', 'be', 'your', 'what', 'how', 'there', 'this',
  'that', 'with', 'available', 'please', 'hi', 'hello', 'hey',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/** Best FAQ by token overlap; requires a real overlap, not a single weak hit. */
export function matchFaq(message: string, faqs: KnowledgeFaq[]): KnowledgeFaq | null {
  const tokens = new Set(tokenize(message));
  if (tokens.size === 0) return null;

  let best: { faq: KnowledgeFaq; score: number } | null = null;
  for (const faq of faqs) {
    const faqTokens = tokenize(faq.question);
    if (faqTokens.length === 0) continue;
    const overlap = faqTokens.filter((token) => tokens.has(token)).length;
    const score = overlap / faqTokens.length;
    if (overlap >= 1 && score >= 0.34 && (!best || score > best.score)) best = { faq, score };
  }
  return best?.faq ?? null;
}

function isGreetingOnly(text: string): boolean {
  return /^\s*(hi|hello|hey|namaste|good (morning|afternoon|evening))[\s!.,]*$/i.test(text);
}

function roomsFor(knowledge: HotelKnowledge, guests: number | null): KnowledgeRoom[] {
  const active = knowledge.rooms;
  if (!guests) return active;
  const fitting = active.filter((room) => room.maxGuests >= guests);
  return fitting.length > 0 ? fitting : active;
}

function firstName(name?: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

function policyOfType(knowledge: HotelKnowledge, type: string): string | null {
  return knowledge.policies.find((policy) => policy.type === type)?.content ?? null;
}

const AVAILABILITY_HEDGE =
  'I will need the hotel team to confirm availability for your dates — I do not have the live room chart here.';

/**
 * Turns a verified snapshot into a sentence. Only called when the application
 * actually checked the dates; with no snapshot the engine keeps hedging, which
 * is what the guardrails independently require.
 */
function describeAvailability(
  snapshot: NonNullable<ReplyInput['availability']>,
  currency: string,
): string {
  const free = snapshot.rooms.filter((room) => room.available);
  const nights = snapshot.nights === 1 ? '1 night' : `${snapshot.nights} nights`;

  if (free.length === 0) {
    return `I have checked ${snapshot.checkIn} to ${snapshot.checkOut} (${nights}) and we are fully booked for those dates. If you can move your dates, tell me and I will check again.`;
  }

  const list = free
    .map(
      (room) =>
        `• ${room.roomName} — ${formatMoney(room.basePrice, currency)} per night, ${room.unitsFree} room${room.unitsFree === 1 ? '' : 's'} free`,
    )
    .join('\n');

  return `For ${snapshot.checkIn} to ${snapshot.checkOut} (${nights}) we have:\n${list}`;
}

export class RulesAiProvider implements AiProvider {
  readonly name = 'rules';
  readonly model = 'rules-v1';

  async analyze(input: AnalyzeInput): Promise<AiAnalysis> {
    const { intent, confidence } = classifyIntent(input.message);
    const entities = extractEntities(input.message, input.now ?? new Date());
    const optedOut = isOptOut(input.message);
    const requiresHuman = intentRequiresHuman(intent);

    let temperature: LeadTemperature = 'low';
    if (intent === 'booking_intent' || intent === 'payment') temperature = 'hot';
    else if (entities.checkIn || entities.guests || intent === 'pricing' || intent === 'room_availability') {
      temperature = 'warm';
    } else if (isQualifyingIntent(intent)) temperature = 'cold';

    return {
      intent,
      confidence,
      leadTemperature: temperature,
      entities,
      requiresHuman,
      requiresFollowUp: !optedOut && isQualifyingIntent(intent),
      suggestedAction: suggestAction(intent, entities.checkIn ?? null, entities.guests ?? null, requiresHuman),
    };
  }

  async reply(input: ReplyInput): Promise<ReplyOutput> {
    const started = Date.now();
    const toolCalls: AiToolCall[] = [];
    const text = this.compose(input, toolCalls);
    return {
      text,
      provider: this.name,
      model: this.model,
      toolCalls,
      latencyMs: Date.now() - started,
    };
  }

  private compose(input: ReplyInput, toolCalls: AiToolCall[]): string {
    const { knowledge, analysis, leadState, message } = input;
    const name = firstName(input.customerName);
    const greeting = name ? `Hi ${name}, ` : '';
    const currency = knowledge.business.currency;

    if (isOptOut(message)) {
      return 'Understood — I will not message you again about this. If you ever need a room with us, just write here.';
    }

    if (analysis.requiresHuman) {
      toolCalls.push({
        name: 'flag_for_human',
        arguments: { reason: `intent=${analysis.intent}` },
      });
      return knowledge.settings.aiEscalationMessage;
    }

    if (isGreetingOnly(message) && input.history.length === 0) {
      return (
        knowledge.settings.aiWelcomeMessage ??
        `Hello! Thanks for writing to ${knowledge.business.name}. How can I help — are you looking for rooms for a particular date?`
      );
    }

    const faq = matchFaq(message, knowledge.faqs);
    if (faq && !['pricing', 'room_availability', 'booking_intent'].includes(analysis.intent)) {
      return `${greeting}${faq.answer}`;
    }

    const missing = this.missingInfoQuestion(leadState, analysis);

    switch (analysis.intent) {
      case 'room_availability':
      case 'room_information':
      case 'pricing': {
        const rooms = roomsFor(knowledge, leadState.guests ?? analysis.entities.guests ?? null);
        if (rooms.length === 0) {
          return `${greeting}I do not have our room details loaded yet — someone from the team will share the options and rates with you shortly.`;
        }

        // With verified numbers, answer the availability question directly.
        if (input.availability && input.availability.nights > 0) {
          const answer = `${greeting}${describeAvailability(input.availability, currency)}`;
          return missing ? `${answer}\n\n${missing}` : answer;
        }

        const list = rooms.map((room) => `• ${describeRoom(room, currency)}`).join('\n');
        const head =
          analysis.intent === 'room_availability'
            ? `${greeting}here is what we have:\n${list}\n\n${AVAILABILITY_HEDGE}`
            : `${greeting}our room options are:\n${list}`;
        return missing ? `${head}\n\n${missing}` : head;
      }

      case 'booking_intent': {
        toolCalls.push({ name: 'flag_for_human', arguments: { reason: 'guest wants to book' } });
        const detail = missing ? ` ${missing}` : '';

        if (input.availability && input.availability.nights > 0) {
          if (!input.availability.anyAvailable) {
            return `${greeting}I have checked ${input.availability.checkIn} to ${input.availability.checkOut} and we are fully booked for those dates. Our team will come back to you here — tell me if other dates would work.`;
          }
          const free = input.availability.rooms.filter((room) => room.available);
          const names = free.map((room) => room.roomName).join(' and ');
          return `${greeting}we do have the ${names} open for ${input.availability.checkIn} to ${input.availability.checkOut}. I have passed this to our team to confirm and complete the booking with you here.${detail}`;
        }

        return `${greeting}happy to take this forward. I will ask our team to confirm availability and come back to you here with the confirmation.${detail}`;
      }

      case 'discount_request': {
        const cheapest = [...knowledge.rooms].sort((a, b) => a.basePrice - b.basePrice)[0];
        const rate = cheapest
          ? ` Our lowest listed rate is ${formatMoney(cheapest.basePrice, currency)} per night for the ${cheapest.name}.`
          : '';
        toolCalls.push({ name: 'flag_for_human', arguments: { reason: 'discount request' } });
        return `${greeting}I am not able to change rates myself.${rate} Let me pass this to our team — they will look at your dates and reply here.`;
      }

      case 'location': {
        const address = knowledge.business.address ?? knowledge.profile.locationNote;
        if (!address) return `${greeting}our team will share the exact location and directions with you shortly.`;
        const landmarks = knowledge.profile.landmarks ? ` ${knowledge.profile.landmarks}` : '';
        return `${greeting}we are at ${address}.${landmarks}`;
      }

      case 'check_in_out': {
        const checkIn = knowledge.profile.checkInTime;
        const checkOut = knowledge.profile.checkOutTime;
        if (!checkIn && !checkOut) {
          return `${greeting}our team will confirm the check-in and check-out timings for you.`;
        }
        const policy = policyOfType(knowledge, 'check_in');
        const base = `${greeting}check-in is from ${checkIn ?? 'the time our team will confirm'} and check-out is by ${checkOut ?? 'the time our team will confirm'}.`;
        return policy ? `${base} ${policy}` : base;
      }

      case 'cancellation': {
        const policy = policyOfType(knowledge, 'cancellation');
        return policy
          ? `${greeting}${policy}`
          : `${greeting}our team will confirm the cancellation terms for your dates.`;
      }

      case 'amenities': {
        const amenities = knowledge.profile.amenities;
        if (amenities.length === 0) {
          return `${greeting}our team will confirm that for you shortly.`;
        }
        return `${greeting}we have ${amenities.join(', ')}. Anything specific you need?`;
      }

      case 'group_booking':
      case 'event_or_conference': {
        toolCalls.push({
          name: 'flag_for_human',
          arguments: { reason: `${analysis.intent} enquiry` },
        });
        return `${greeting}for a group like this our team will put together the right options for you. I have passed your enquiry on — they will reply here shortly.`;
      }

      case 'airport_transfer':
      case 'restaurant_or_food':
      case 'hotel_information': {
        const description = knowledge.profile.description;
        return description
          ? `${greeting}${description} Our team will confirm anything specific you need.`
          : `${greeting}our team will confirm that for you shortly.`;
      }

      default: {
        if (missing) return `${greeting}${missing}`;
        return `${greeting}happy to help. Could you tell me a little more about what you need for your stay?`;
      }
    }
  }

  /** One question at a time: dates first, then guests. */
  private missingInfoQuestion(
    leadState: ReplyInput['leadState'],
    analysis: AiAnalysis,
  ): string | null {
    const checkIn = leadState.checkIn ?? analysis.entities.checkIn ?? null;
    const guests = leadState.guests ?? analysis.entities.guests ?? null;
    if (!checkIn) return 'Which dates are you looking at?';
    if (!guests) return 'How many guests will be staying?';
    return null;
  }
}

function suggestAction(
  intent: AiAnalysis['intent'],
  checkIn: string | null,
  guests: number | null,
  requiresHuman: boolean,
): SuggestedAction {
  if (requiresHuman) return 'escalate_to_human';
  if (intent === 'booking_intent') return 'move_to_booking';
  if (!checkIn && isQualifyingIntent(intent)) return 'ask_for_dates';
  if (!guests && isQualifyingIntent(intent)) return 'ask_for_guests';
  if (intent === 'pricing' || intent === 'room_information') return 'offer_room_options';
  if (intent === 'unknown') return 'answer_question';
  return 'answer_question';
}
