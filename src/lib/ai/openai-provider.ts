import OpenAI from 'openai';
import { z } from 'zod';
import { LEAD_INTENTS, type LeadIntent, type LeadTemperature } from '@/types/domain';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import {
  ANALYSIS_INSTRUCTIONS,
  buildSystemPrompt,
  formatAvailabilityForPrompt,
  formatHistoryForPrompt,
  formatLeadStateForPrompt,
} from './prompts';
import { extractEntities, mergeEntities, type BookingEntities } from './entities';
import { classifyIntent } from './intent';
import { SUGGESTED_ACTIONS, type AiAnalysis, type AiProvider, type AiToolCall, type AnalyzeInput, type ReplyInput, type ReplyOutput, type SuggestedAction } from './types';

/**
 * OpenAI-backed conversation engine using the Responses API.
 *
 * Two calls per inbound message:
 *  1. analyze() — strict structured output, so intent/entities arrive as typed
 *     data rather than prose that has to be parsed.
 *  2. reply()   — tool-calling loop. Read tools resolve against the trusted
 *     hotel snapshot; action tools are collected and returned to the pipeline,
 *     which decides whether to apply them. The model never touches the database.
 */

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'confidence',
    'lead_temperature',
    'entities',
    'requires_human',
    'requires_follow_up',
    'suggested_action',
  ],
  properties: {
    intent: { type: 'string', enum: [...LEAD_INTENTS] },
    confidence: { type: 'number', description: 'Between 0 and 1.' },
    lead_temperature: { type: 'string', enum: ['hot', 'warm', 'cold', 'low'] },
    entities: {
      type: 'object',
      additionalProperties: false,
      required: ['check_in', 'check_out', 'guests', 'nights', 'room_preference'],
      properties: {
        check_in: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, or null.' },
        check_out: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, or null.' },
        guests: { type: ['integer', 'null'] },
        nights: { type: ['integer', 'null'] },
        room_preference: { type: ['string', 'null'] },
      },
    },
    requires_human: { type: 'boolean' },
    requires_follow_up: { type: 'boolean' },
    suggested_action: { type: 'string', enum: [...SUGGESTED_ACTIONS] },
  },
} as const;

const analysisResponseSchema = z.object({
  intent: z.enum(LEAD_INTENTS as unknown as [LeadIntent, ...LeadIntent[]]),
  confidence: z.number().min(0).max(1),
  lead_temperature: z.enum(['hot', 'warm', 'cold', 'low']),
  entities: z.object({
    check_in: z.string().nullable(),
    check_out: z.string().nullable(),
    guests: z.number().int().positive().nullable(),
    nights: z.number().int().positive().nullable(),
    room_preference: z.string().nullable(),
  }),
  requires_human: z.boolean(),
  requires_follow_up: z.boolean(),
  suggested_action: z.enum(SUGGESTED_ACTIONS as unknown as [SuggestedAction, ...SuggestedAction[]]),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toBookingEntities(raw: z.infer<typeof analysisResponseSchema>['entities']): BookingEntities {
  const entities: BookingEntities = {};
  if (raw.check_in && ISO_DATE.test(raw.check_in)) entities.checkIn = raw.check_in;
  if (raw.check_out && ISO_DATE.test(raw.check_out)) entities.checkOut = raw.check_out;
  if (raw.guests) entities.guests = raw.guests;
  if (raw.nights) entities.nights = raw.nights;
  if (raw.room_preference) entities.roomPreference = raw.room_preference;
  return entities;
}

/** Read tools resolve against trusted data; action tools are returned to the caller. */
function buildTools(): OpenAI.Responses.Tool[] {
  const fn = (
    name: string,
    description: string,
    properties: Record<string, unknown> = {},
    required: string[] = [],
  ): OpenAI.Responses.Tool => ({
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties,
      required,
    },
  });

  return [
    fn('get_hotel_profile', 'Hotel name, address, description, check-in/check-out times and amenities.'),
    fn(
      'get_room_types',
      'All bookable room types with their nightly rates, capacity and total room count. This is NOT availability.',
    ),
    fn(
      'get_room_details',
      'Full detail for one room type.',
      { room_id: { type: 'string' } },
      ['room_id'],
    ),
    fn('get_hotel_policies', 'Cancellation, payment, child, pet and other configured policies.'),
    fn('get_faqs', 'Frequently asked questions the hotel has answered.'),
    fn('get_business_hours', 'Reception and service hours.'),
    fn('get_current_conversation_state', 'What is already known about this enquiry.'),
    fn(
      'flag_for_human',
      'Hand this conversation to hotel staff. Use for complaints, payment issues, or when the guest asks for a person.',
      { reason: { type: 'string' } },
      ['reason'],
    ),
    fn(
      'schedule_follow_up',
      'Ask the system to follow up if the guest goes quiet.',
      { delay_minutes: { type: ['integer', 'null'] }, reason: { type: ['string', 'null'] } },
      ['delay_minutes', 'reason'],
    ),
    fn(
      'cancel_follow_up',
      'Stop any pending automated follow-up for this enquiry.',
      { reason: { type: ['string', 'null'] } },
      ['reason'],
    ),
    fn(
      'update_lead',
      'Record confirmed booking details for this enquiry.',
      {
        check_in: { type: ['string', 'null'] },
        check_out: { type: ['string', 'null'] },
        guests: { type: ['integer', 'null'] },
        room_preference: { type: ['string', 'null'] },
        estimated_value: { type: ['number', 'null'] },
      },
      ['check_in', 'check_out', 'guests', 'room_preference', 'estimated_value'],
    ),
  ];
}

const ACTION_TOOLS = new Set(['flag_for_human', 'schedule_follow_up', 'cancel_follow_up', 'update_lead']);
const MAX_TOOL_ROUNDS = 4;

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async analyze(input: AnalyzeInput): Promise<AiAnalysis> {
    const now = input.now ?? new Date();
    const localEntities = extractEntities(input.message, now);

    const response = await this.client.responses.create({
      model: this.model,
      instructions: ANALYSIS_INSTRUCTIONS,
      temperature: 0,
      input: [
        {
          role: 'user',
          content: [
            `Today is ${now.toISOString().slice(0, 10)}.`,
            `Hotel: ${input.knowledge.business.name}`,
            '',
            'Conversation so far:',
            formatHistoryForPrompt(input.history),
            '',
            `New message from the guest: ${input.message}`,
          ].join('\n'),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'lead_analysis',
          strict: true,
          schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    const parsed = analysisResponseSchema.parse(JSON.parse(response.output_text));

    const analysis: AiAnalysis = {
      intent: parsed.intent,
      confidence: parsed.confidence,
      leadTemperature: parsed.lead_temperature as LeadTemperature,
      // Locally extracted dates/guests take precedence: they are reproducible.
      entities: mergeEntities(toBookingEntities(parsed.entities), localEntities),
      requiresHuman: parsed.requires_human,
      requiresFollowUp: parsed.requires_follow_up,
      suggestedAction: parsed.suggested_action,
    };

    // When the model is unsure, prefer the deterministic classifier: an intent
    // nobody can corroborate drives scoring and escalation just as hard as one
    // everybody agrees on.
    return corroborateIntent(input.message, analysis);
  }

  async reply(input: ReplyInput): Promise<ReplyOutput> {
    const started = Date.now();
    const toolCalls: AiToolCall[] = [];

    const conversation: OpenAI.Responses.ResponseInput = [
      {
        role: 'user',
        content: [
          formatLeadStateForPrompt(input.leadState),
          `Detected intent: ${input.analysis.intent}.`,
          '',
          formatAvailabilityForPrompt(input.availability, input.knowledge.business.currency),
          '',
          'Conversation so far:',
          formatHistoryForPrompt(input.history),
          '',
          `New message from the guest: ${input.message}`,
          '',
          'Write the reply to send on WhatsApp. Reply with the message text only.',
        ].join('\n'),
      },
    ];

    const instructions = buildSystemPrompt(input.knowledge, input.knowledge.settings.aiTone);
    const tools = buildTools();

    let text: string | null = null;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.client.responses.create({
        model: this.model,
        instructions,
        input: conversation,
        tools,
        temperature: 0.4,
        max_output_tokens: 500,
      });

      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      if (functionCalls.length === 0) {
        text = response.output_text?.trim() || null;
        break;
      }

      // Only the tool calls need to be echoed back; other output items are
      // not valid request input.
      conversation.push(...functionCalls);

      for (const call of functionCalls) {
        const args = safeJson(call.arguments);
        if (ACTION_TOOLS.has(call.name)) {
          const action = toActionCall(call.name, args);
          if (action) toolCalls.push(action);
          conversation.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({ accepted: true, note: 'Queued for the hotel system to apply.' }),
          });
        } else {
          conversation.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(resolveReadTool(call.name, args, input)),
          });
        }
      }
    }

    return {
      text,
      provider: this.name,
      model: this.model,
      toolCalls,
      latencyMs: Date.now() - started,
    };
  }
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toActionCall(name: string, args: Record<string, unknown>): AiToolCall | null {
  switch (name) {
    case 'flag_for_human':
      return { name, arguments: { reason: asString(args.reason) ?? 'unspecified' } };
    case 'schedule_follow_up': {
      const delay = asNumber(args.delay_minutes);
      return {
        name,
        arguments: {
          ...(delay !== undefined ? { delay_minutes: delay } : {}),
          ...(asString(args.reason) ? { reason: asString(args.reason) as string } : {}),
        },
      };
    }
    case 'cancel_follow_up':
      return {
        name,
        arguments: asString(args.reason) ? { reason: asString(args.reason) as string } : {},
      };
    case 'update_lead': {
      const payload: Extract<AiToolCall, { name: 'update_lead' }>['arguments'] = {};
      const checkIn = asString(args.check_in);
      const checkOut = asString(args.check_out);
      const guests = asNumber(args.guests);
      const room = asString(args.room_preference);
      const value = asNumber(args.estimated_value);
      if (checkIn && ISO_DATE.test(checkIn)) payload.check_in = checkIn;
      if (checkOut && ISO_DATE.test(checkOut)) payload.check_out = checkOut;
      if (guests !== undefined && guests > 0) payload.guests = Math.round(guests);
      if (room) payload.room_preference = room;
      if (value !== undefined && value > 0) payload.estimated_value = value;
      return Object.keys(payload).length > 0 ? { name, arguments: payload } : null;
    }
    default:
      return null;
  }
}

/** Read tools are answered from the trusted snapshot, never from model memory. */
export function resolveReadTool(
  name: string,
  args: Record<string, unknown>,
  input: ReplyInput,
): unknown {
  const knowledge: HotelKnowledge = input.knowledge;
  switch (name) {
    case 'get_hotel_profile':
      return {
        name: knowledge.business.name,
        address: knowledge.business.address,
        city: knowledge.business.city,
        phone: knowledge.business.phone,
        website: knowledge.business.website,
        currency: knowledge.business.currency,
        description: knowledge.profile.description,
        location_note: knowledge.profile.locationNote,
        landmarks: knowledge.profile.landmarks,
        check_in_time: knowledge.profile.checkInTime,
        check_out_time: knowledge.profile.checkOutTime,
        amenities: knowledge.profile.amenities,
      };
    case 'get_room_types':
      return knowledge.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        base_price: room.basePrice,
        currency: knowledge.business.currency,
        max_guests: room.maxGuests,
        breakfast_included: room.breakfastIncluded,
      }));
    case 'get_room_details': {
      const room = knowledge.rooms.find((candidate) => candidate.id === asString(args.room_id));
      return room ?? { error: 'No room type with that id is configured for this hotel.' };
    }
    case 'get_hotel_policies':
      return knowledge.policies;
    case 'get_faqs':
      return knowledge.faqs;
    case 'get_business_hours':
      return knowledge.profile.businessHours;
    case 'get_current_conversation_state':
      return {
        known_check_in: input.leadState.checkIn,
        known_check_out: input.leadState.checkOut,
        known_guests: input.leadState.guests,
        room_preference: input.leadState.roomPreference,
        follow_ups_sent: input.leadState.followUpsSent,
        // Availability is verified per enquiry by the application, never by the
        // model. Absent means it was not checked, which is not the same as free.
        availability_checked: Boolean(input.availability && input.availability.nights > 0),
        availability: input.availability
          ? {
              check_in: input.availability.checkIn,
              check_out: input.availability.checkOut,
              nights: input.availability.nights,
              any_available: input.availability.anyAvailable,
              rooms: input.availability.rooms.map((room) => ({
                name: room.roomName,
                units_free: room.unitsFree,
                available: room.available,
                sold_out_dates: room.soldOutDates,
              })),
            }
          : null,
      };
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Cross-check used when model confidence is low. */
export function corroborateIntent(message: string, analysis: AiAnalysis): AiAnalysis {
  if (analysis.confidence >= 0.5) return analysis;
  const local = classifyIntent(message);
  if (local.intent === 'unknown') return analysis;
  return { ...analysis, intent: local.intent, confidence: local.confidence };
}
