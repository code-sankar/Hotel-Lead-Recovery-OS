/**
 * Domain types mirroring supabase/migrations. Kept hand-written (rather than
 * generated) so the app has a single, reviewable contract with the database.
 */

export type MemberRole = 'owner' | 'manager' | 'staff';

export type ConversationMode = 'ai' | 'human' | 'paused';
export type ConversationStatus = 'open' | 'resolved';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderType = 'customer' | 'ai' | 'staff' | 'system';
export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'location'
  | 'interactive'
  | 'template'
  | 'unsupported';
export type MessageDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  /** Demo mode: composed by the app but never handed to Meta. */
  | 'simulated';

export type LeadStatus =
  | 'new'
  | 'active'
  | 'follow_up_due'
  | 'hot'
  | 'warm'
  | 'cold'
  | 'converted'
  | 'lost'
  | 'paused';

export type LeadTemperature = 'hot' | 'warm' | 'cold' | 'low';

export type LeadIntent =
  | 'room_availability'
  | 'pricing'
  | 'booking_intent'
  | 'room_information'
  | 'hotel_information'
  | 'amenities'
  | 'location'
  | 'check_in_out'
  | 'cancellation'
  | 'payment'
  | 'discount_request'
  | 'group_booking'
  | 'event_or_conference'
  | 'airport_transfer'
  | 'restaurant_or_food'
  | 'complaint'
  | 'human_help'
  | 'unknown';

export const LEAD_INTENTS: readonly LeadIntent[] = [
  'room_availability',
  'pricing',
  'booking_intent',
  'room_information',
  'hotel_information',
  'amenities',
  'location',
  'check_in_out',
  'cancellation',
  'payment',
  'discount_request',
  'group_booking',
  'event_or_conference',
  'airport_transfer',
  'restaurant_or_food',
  'complaint',
  'human_help',
  'unknown',
] as const;

export type FollowUpTrigger = 'customer_inactive' | 'previous_follow_up_sent';
export type FollowUpStatus = 'scheduled' | 'sent' | 'cancelled' | 'failed' | 'skipped';

export type HotelPolicyType =
  | 'cancellation'
  | 'child'
  | 'extra_bed'
  | 'check_in'
  | 'check_out'
  | 'pet'
  | 'payment'
  | 'smoking'
  | 'other';

export const HOTEL_POLICY_TYPES: readonly HotelPolicyType[] = [
  'cancellation',
  'child',
  'extra_bed',
  'check_in',
  'check_out',
  'pet',
  'payment',
  'smoking',
  'other',
] as const;

export type MessagingMode = 'demo' | 'live';
export type WhatsAppConnectionStatus = 'not_configured' | 'configured' | 'verified' | 'error';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  phone: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  messaging_mode: MessagingMode;
  is_demo: boolean;
  onboarding_completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessMember {
  id: string;
  business_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

export interface BusinessProfile {
  business_id: string;
  description: string | null;
  location_note: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  business_hours: Record<string, unknown>;
  amenities: string[];
  landmarks: string | null;
  updated_at: string;
}

export type BookingStatus = 'confirmed' | 'cancelled';

export interface Room {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  base_price: number;
  max_guests: number;
  /** How many physical rooms of this type exist. Baseline for availability. */
  total_units: number;
  amenities: string[];
  breakfast_included: boolean;
  notes: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HotelPolicy {
  id: string;
  business_id: string;
  type: HotelPolicyType;
  title: string | null;
  content: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HotelFaq {
  id: string;
  business_id: string;
  question: string;
  answer: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BusinessSettings {
  business_id: string;
  ai_enabled: boolean;
  ai_tone: string;
  ai_welcome_message: string | null;
  ai_escalation_message: string;
  follow_ups_enabled: boolean;
  max_follow_ups: number;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  updated_at: string;
}

/** Non-secret projection of whatsapp_integrations, safe for the browser. */
export interface WhatsAppIntegrationStatus {
  business_id: string;
  display_phone_number: string | null;
  status: WhatsAppConnectionStatus;
  last_error: string | null;
  last_verified_at: string | null;
  has_phone_number_id: boolean;
  has_waba_id: boolean;
  has_access_token: boolean;
  has_app_secret: boolean;
  has_verify_token: boolean;
  updated_at: string;
}

/** Server-only. Never returned to a client component. */
export interface WhatsAppIntegrationSecrets {
  business_id: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  waba_id: string | null;
  access_token: string | null;
  app_secret: string | null;
  verify_token: string | null;
  status: WhatsAppConnectionStatus;
}

export interface WhatsAppTemplate {
  id: string;
  business_id: string;
  purpose: string;
  template_name: string;
  language_code: string;
  body_preview: string | null;
  variable_map: unknown[];
  active: boolean;
}

export interface Customer {
  id: string;
  business_id: string;
  phone_number: string;
  name: string | null;
  email: string | null;
  language: string | null;
  notes: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_id: string;
  mode: ConversationMode;
  status: ConversationStatus;
  channel: string;
  assigned_staff_id: string | null;
  taken_over_by: string | null;
  taken_over_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  business_id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  sender_user_id: string | null;
  message_type: MessageType;
  text: string | null;
  provider_message_id: string | null;
  template_name: string | null;
  delivery_status: MessageDeliveryStatus | null;
  ai_model: string | null;
  raw_payload: unknown | null;
  error: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  business_id: string;
  customer_id: string;
  conversation_id: string;
  status: LeadStatus;
  temperature: LeadTemperature;
  lead_score: number;
  intent: LeadIntent;
  estimated_value: number | null;
  expected_check_in: string | null;
  expected_check_out: string | null;
  guests: number | null;
  room_preference: string | null;
  source: string;
  assigned_staff_id: string | null;
  follow_ups_sent: number;
  last_customer_message_at: string | null;
  last_response_at: string | null;
  next_follow_up_at: string | null;
  converted_at: string | null;
  conversion_value: number | null;
  lost_at: string | null;
  loss_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type LeadEventType =
  | 'lead_created'
  | 'lead_scored'
  | 'intent_detected'
  | 'ai_replied'
  | 'ai_skipped'
  | 'follow_up_scheduled'
  | 'follow_up_sent'
  | 'follow_up_cancelled'
  | 'customer_replied'
  | 'human_takeover'
  | 'ai_resumed'
  | 'ai_paused'
  | 'staff_replied'
  | 'lead_assigned'
  | 'lead_converted'
  | 'lead_lost'
  | 'note_added'
  | 'customer_opted_out';

export interface LeadEvent {
  id: string;
  business_id: string;
  lead_id: string;
  type: LeadEventType | string;
  actor_type: string;
  actor_user_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface FollowUpRule {
  id: string;
  business_id: string;
  name: string;
  trigger: FollowUpTrigger;
  delay_minutes: number;
  sequence_index: number;
  conditions: FollowUpConditions;
  message_template: string;
  whatsapp_template_purpose: string | null;
  active: boolean;
}

export interface FollowUpConditions {
  lead_status_not_in?: LeadStatus[];
  conversation_mode?: ConversationMode;
}

export interface FollowUp {
  id: string;
  business_id: string;
  lead_id: string;
  conversation_id: string;
  rule_id: string | null;
  sequence_index: number;
  status: FollowUpStatus;
  scheduled_for: string;
  sent_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  message_id: string | null;
  body: string | null;
  attempts: number;
  last_error: string | null;
  created_by: string;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

export interface AiAction {
  id: string;
  business_id: string;
  conversation_id: string;
  lead_id: string | null;
  inbound_message_id: string | null;
  outbound_message_id: string | null;
  provider: string;
  model: string | null;
  intent: LeadIntent | null;
  confidence: number | null;
  requires_human: boolean;
  requires_follow_up: boolean;
  suggested_action: string | null;
  entities: Record<string, unknown>;
  decision: string;
  guardrail_flags: string[];
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface StaffNote {
  id: string;
  business_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface AnalyticsEvent {
  id: string;
  business_id: string;
  type: string;
  lead_id: string | null;
  conversation_id: string | null;
  value: number | null;
  data: Record<string, unknown>;
  occurred_at: string;
}

export interface RoomAvailability {
  id: string;
  business_id: string;
  room_id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** null means "use rooms.total_units for this date". */
  units_available: number | null;
  closed: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  business_id: string;
  lead_id: string | null;
  customer_id: string;
  room_id: string;
  check_in: string;
  check_out: string;
  units: number;
  guests: number | null;
  status: BookingStatus;
  total_value: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
