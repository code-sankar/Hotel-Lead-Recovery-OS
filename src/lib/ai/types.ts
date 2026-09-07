import type { LeadIntent, LeadStatus, LeadTemperature } from '@/types/domain';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import type { BookingEntities } from './entities';

export interface ConversationTurn {
  role: 'customer' | 'ai' | 'staff' | 'system';
  text: string;
  at: string;
}

export type SuggestedAction =
  | 'answer_question'
  | 'ask_for_dates'
  | 'ask_for_guests'
  | 'offer_room_options'
  | 'move_to_booking'
  | 'escalate_to_human'
  | 'acknowledge_and_close'
  | 'no_action';

export const SUGGESTED_ACTIONS: readonly SuggestedAction[] = [
  'answer_question',
  'ask_for_dates',
  'ask_for_guests',
  'offer_room_options',
  'move_to_booking',
  'escalate_to_human',
  'acknowledge_and_close',
  'no_action',
] as const;

/** Structured analysis of one inbound customer message. */
export interface AiAnalysis {
  intent: LeadIntent;
  confidence: number;
  leadTemperature: LeadTemperature;
  entities: BookingEntities;
  requiresHuman: boolean;
  requiresFollowUp: boolean;
  suggestedAction: SuggestedAction;
}

export interface LeadStateSummary {
  status: LeadStatus;
  score: number;
  temperature: LeadTemperature;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  roomPreference: string | null;
  followUpsSent: number;
}

export interface AnalyzeInput {
  message: string;
  history: ConversationTurn[];
  knowledge: HotelKnowledge;
  customerName?: string | null;
  now?: Date;
}

export interface ReplyInput {
  message: string;
  history: ConversationTurn[];
  knowledge: HotelKnowledge;
  analysis: AiAnalysis;
  leadState: LeadStateSummary;
  customerName?: string | null;
}

/**
 * Actions the model may REQUEST. They are returned to the pipeline, which
 * validates and applies them. The model never writes to the database itself.
 */
export type AiToolCall =
  | { name: 'flag_for_human'; arguments: { reason: string } }
  | { name: 'schedule_follow_up'; arguments: { delay_minutes?: number; reason?: string } }
  | { name: 'cancel_follow_up'; arguments: { reason?: string } }
  | {
      name: 'update_lead';
      arguments: {
        check_in?: string;
        check_out?: string;
        guests?: number;
        room_preference?: string;
        estimated_value?: number;
      };
    };

export interface ReplyOutput {
  text: string | null;
  provider: string;
  model: string;
  toolCalls: AiToolCall[];
  latencyMs: number;
  error?: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: AnalyzeInput): Promise<AiAnalysis>;
  reply(input: ReplyInput): Promise<ReplyOutput>;
}
