import type {
  AiAction,
  AnalyticsEvent,
  Booking,
  Business,
  BusinessSettings,
  Conversation,
  Customer,
  FollowUp,
  FollowUpRule,
  Lead,
  LeadEvent,
  Message,
  RoomAvailability,
  WhatsAppIntegrationSecrets,
  WhatsAppTemplate,
} from '@/types/domain';
import type { HotelKnowledge } from '@/lib/knowledge/types';

/**
 * The data port used by every server-side workflow (inbound pipeline,
 * follow-up engine, demo simulation).
 *
 * Defining it as an interface keeps the orchestration logic free of Supabase
 * specifics, and lets the integration tests run the real pipeline against an
 * in-memory implementation. Every method takes `businessId` explicitly: the
 * service-role adapter bypasses RLS, so tenant scoping is a required argument
 * rather than an ambient assumption.
 */
export interface Store {
  // --- tenant resolution ---------------------------------------------------
  findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null>;
  getBusiness(businessId: string): Promise<Business | null>;

  // --- hotel knowledge -----------------------------------------------------
  loadKnowledge(businessId: string): Promise<HotelKnowledge | null>;
  getSettings(businessId: string): Promise<BusinessSettings | null>;

  // --- customers -----------------------------------------------------------
  findOrCreateCustomer(input: FindOrCreateCustomerInput): Promise<Customer>;
  getCustomer(businessId: string, customerId: string): Promise<Customer | null>;
  updateCustomer(businessId: string, customerId: string, patch: Partial<Customer>): Promise<void>;

  // --- conversations -------------------------------------------------------
  findOrCreateConversation(businessId: string, customerId: string): Promise<Conversation>;
  getConversation(businessId: string, conversationId: string): Promise<Conversation | null>;
  updateConversation(
    businessId: string,
    conversationId: string,
    patch: Partial<Conversation>,
  ): Promise<void>;

  // --- messages ------------------------------------------------------------
  findMessageByProviderId(businessId: string, providerMessageId: string): Promise<Message | null>;
  insertMessage(input: InsertMessageInput): Promise<Message>;
  updateMessage(businessId: string, messageId: string, patch: Partial<Message>): Promise<void>;
  listMessages(businessId: string, conversationId: string, limit?: number): Promise<Message[]>;

  // --- leads ---------------------------------------------------------------
  getLeadByConversation(businessId: string, conversationId: string): Promise<Lead | null>;
  getLead(businessId: string, leadId: string): Promise<Lead | null>;
  createLead(input: CreateLeadInput): Promise<Lead>;
  updateLead(businessId: string, leadId: string, patch: Partial<Lead>): Promise<Lead>;
  insertLeadEvent(input: InsertLeadEventInput): Promise<LeadEvent>;
  listLeadEvents(businessId: string, leadId: string, limit?: number): Promise<LeadEvent[]>;

  // --- follow-ups ----------------------------------------------------------
  listFollowUpRules(businessId: string): Promise<FollowUpRule[]>;
  getFollowUp(businessId: string, followUpId: string): Promise<FollowUp | null>;
  listFollowUpsForLead(businessId: string, leadId: string): Promise<FollowUp[]>;
  findFollowUpByDedupeKey(businessId: string, dedupeKey: string): Promise<FollowUp | null>;
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUp>;
  updateFollowUp(businessId: string, followUpId: string, patch: Partial<FollowUp>): Promise<void>;
  cancelScheduledFollowUps(businessId: string, leadId: string, reason: string): Promise<FollowUp[]>;
  /** Cross-tenant sweep used by the worker; each row carries its own business_id. */
  listDueFollowUps(now: Date, limit?: number): Promise<FollowUp[]>;

  // --- availability --------------------------------------------------------
  /** Per-date overrides touching [from, to). */
  listRoomAvailability(businessId: string, from: string, to: string): Promise<RoomAvailability[]>;
  /** Confirmed bookings overlapping [from, to). */
  listBookings(businessId: string, from: string, to: string): Promise<Booking[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;

  // --- telemetry -----------------------------------------------------------
  insertAiAction(input: InsertAiActionInput): Promise<AiAction>;
  insertAnalyticsEvent(input: InsertAnalyticsEventInput): Promise<AnalyticsEvent>;

  // --- provider plumbing ---------------------------------------------------
  getWhatsAppIntegration(businessId: string): Promise<WhatsAppIntegrationSecrets | null>;
  getWhatsAppTemplate(businessId: string, purpose: string): Promise<WhatsAppTemplate | null>;
  /** Returns false when this provider event has already been recorded. */
  recordWebhookEvent(input: RecordWebhookEventInput): Promise<{ isNew: boolean }>;
  markWebhookEventProcessed(
    providerEventId: string,
    status: 'processed' | 'failed',
    error?: string,
  ): Promise<void>;
}

export interface FindOrCreateCustomerInput {
  businessId: string;
  phoneNumber: string;
  name?: string | null;
}

export interface InsertMessageInput {
  businessId: string;
  conversationId: string;
  direction: Message['direction'];
  senderType: Message['sender_type'];
  senderUserId?: string | null;
  messageType?: Message['message_type'];
  text?: string | null;
  providerMessageId?: string | null;
  templateName?: string | null;
  deliveryStatus?: Message['delivery_status'];
  aiModel?: string | null;
  rawPayload?: unknown;
  error?: string | null;
}

export interface CreateLeadInput {
  businessId: string;
  customerId: string;
  conversationId: string;
  status?: Lead['status'];
  intent?: Lead['intent'];
  source?: string;
  lastCustomerMessageAt?: string | null;
}

export interface InsertLeadEventInput {
  businessId: string;
  leadId: string;
  type: string;
  actorType?: string;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
}

export interface CreateFollowUpInput {
  businessId: string;
  leadId: string;
  conversationId: string;
  ruleId: string | null;
  sequenceIndex: number;
  scheduledFor: string;
  body: string | null;
  dedupeKey: string;
  createdBy?: string;
}

export interface CreateBookingInput {
  businessId: string;
  leadId?: string | null;
  customerId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  units?: number;
  guests?: number | null;
  totalValue?: number | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface InsertAiActionInput {
  businessId: string;
  conversationId: string;
  leadId?: string | null;
  inboundMessageId?: string | null;
  outboundMessageId?: string | null;
  provider: string;
  model?: string | null;
  intent?: AiAction['intent'];
  confidence?: number | null;
  requiresHuman?: boolean;
  requiresFollowUp?: boolean;
  suggestedAction?: string | null;
  entities?: Record<string, unknown>;
  decision: string;
  guardrailFlags?: string[];
  latencyMs?: number | null;
  error?: string | null;
}

export interface InsertAnalyticsEventInput {
  businessId: string;
  type: string;
  leadId?: string | null;
  conversationId?: string | null;
  value?: number | null;
  data?: Record<string, unknown>;
  occurredAt?: string;
}

export interface RecordWebhookEventInput {
  provider: string;
  providerEventId: string;
  businessId?: string | null;
  payload?: unknown;
}
