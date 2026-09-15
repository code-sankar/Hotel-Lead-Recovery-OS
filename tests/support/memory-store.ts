import { randomUUID } from 'node:crypto';
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
import type {
  CreateBookingInput,
  CreateFollowUpInput,
  CreateLeadInput,
  FindOrCreateCustomerInput,
  InsertAiActionInput,
  InsertAnalyticsEventInput,
  InsertLeadEventInput,
  InsertMessageInput,
  RecordWebhookEventInput,
  Store,
} from '@/lib/db/store';

/**
 * In-memory Store used by the integration tests.
 *
 * It mirrors the constraints that matter to the pipeline's correctness:
 * uniqueness of (business_id, provider_message_id), uniqueness of follow-up
 * dedupe keys, one lead per conversation, and strict business_id scoping on
 * every read — so a test that leaks across tenants fails here too.
 */
export class MemoryStore implements Store {
  businesses = new Map<string, Business>();
  knowledge = new Map<string, HotelKnowledge>();
  settings = new Map<string, BusinessSettings>();
  customers: Customer[] = [];
  conversations: Conversation[] = [];
  messages: Message[] = [];
  leads: Lead[] = [];
  leadEvents: LeadEvent[] = [];
  followUpRules: FollowUpRule[] = [];
  followUps: FollowUp[] = [];
  aiActions: AiAction[] = [];
  analyticsEvents: AnalyticsEvent[] = [];
  roomAvailability: RoomAvailability[] = [];
  bookings: Booking[] = [];
  integrations = new Map<string, WhatsAppIntegrationSecrets>();
  templates: WhatsAppTemplate[] = [];
  webhookEvents = new Map<string, { status: string; error?: string }>();

  private now(): string {
    return new Date().toISOString();
  }

  async findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    for (const [businessId, integration] of this.integrations) {
      if (integration.phone_number_id === phoneNumberId) {
        return this.businesses.get(businessId) ?? null;
      }
    }
    return null;
  }

  async getBusiness(businessId: string): Promise<Business | null> {
    return this.businesses.get(businessId) ?? null;
  }

  async loadKnowledge(businessId: string): Promise<HotelKnowledge | null> {
    return this.knowledge.get(businessId) ?? null;
  }

  async getSettings(businessId: string): Promise<BusinessSettings | null> {
    return this.settings.get(businessId) ?? null;
  }

  async findOrCreateCustomer(input: FindOrCreateCustomerInput): Promise<Customer> {
    const existing = this.customers.find(
      (c) => c.business_id === input.businessId && c.phone_number === input.phoneNumber,
    );
    if (existing) {
      if (!existing.name && input.name) existing.name = input.name;
      return existing;
    }
    const customer: Customer = {
      id: randomUUID(),
      business_id: input.businessId,
      phone_number: input.phoneNumber,
      name: input.name ?? null,
      email: null,
      language: null,
      notes: null,
      opted_out: false,
      opted_out_at: null,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.customers.push(customer);
    return customer;
  }

  async getCustomer(businessId: string, customerId: string): Promise<Customer | null> {
    return (
      this.customers.find((c) => c.id === customerId && c.business_id === businessId) ?? null
    );
  }

  async updateCustomer(
    businessId: string,
    customerId: string,
    patch: Partial<Customer>,
  ): Promise<void> {
    const customer = await this.getCustomer(businessId, customerId);
    if (customer) Object.assign(customer, patch, { updated_at: this.now() });
  }

  async findOrCreateConversation(businessId: string, customerId: string): Promise<Conversation> {
    const existing = this.conversations.find(
      (c) => c.business_id === businessId && c.customer_id === customerId,
    );
    if (existing) return existing;
    const conversation: Conversation = {
      id: randomUUID(),
      business_id: businessId,
      customer_id: customerId,
      mode: 'ai',
      status: 'open',
      channel: 'whatsapp',
      assigned_staff_id: null,
      taken_over_by: null,
      taken_over_at: null,
      last_inbound_at: null,
      last_outbound_at: null,
      last_message_at: null,
      last_message_preview: null,
      unread_count: 0,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.conversations.push(conversation);
    return conversation;
  }

  async getConversation(businessId: string, conversationId: string): Promise<Conversation | null> {
    return (
      this.conversations.find((c) => c.id === conversationId && c.business_id === businessId) ?? null
    );
  }

  async updateConversation(
    businessId: string,
    conversationId: string,
    patch: Partial<Conversation>,
  ): Promise<void> {
    const conversation = await this.getConversation(businessId, conversationId);
    if (conversation) Object.assign(conversation, patch, { updated_at: this.now() });
  }

  async findMessageByProviderId(
    businessId: string,
    providerMessageId: string,
  ): Promise<Message | null> {
    return (
      this.messages.find(
        (m) => m.business_id === businessId && m.provider_message_id === providerMessageId,
      ) ?? null
    );
  }

  async insertMessage(input: InsertMessageInput): Promise<Message> {
    if (input.providerMessageId) {
      const existing = await this.findMessageByProviderId(input.businessId, input.providerMessageId);
      if (existing) return existing;
    }
    const message: Message = {
      id: randomUUID(),
      business_id: input.businessId,
      conversation_id: input.conversationId,
      direction: input.direction,
      sender_type: input.senderType,
      sender_user_id: input.senderUserId ?? null,
      message_type: input.messageType ?? 'text',
      text: input.text ?? null,
      provider_message_id: input.providerMessageId ?? null,
      template_name: input.templateName ?? null,
      delivery_status: input.deliveryStatus ?? null,
      ai_model: input.aiModel ?? null,
      raw_payload: input.rawPayload ?? null,
      error: input.error ?? null,
      created_at: this.now(),
    };
    this.messages.push(message);
    return message;
  }

  async updateMessage(
    businessId: string,
    messageId: string,
    patch: Partial<Message>,
  ): Promise<void> {
    const message = this.messages.find((m) => m.id === messageId && m.business_id === businessId);
    if (message) Object.assign(message, patch);
  }

  async listMessages(
    businessId: string,
    conversationId: string,
    limit = 50,
  ): Promise<Message[]> {
    return this.messages
      .filter((m) => m.business_id === businessId && m.conversation_id === conversationId)
      .slice(-limit);
  }

  async getLeadByConversation(businessId: string, conversationId: string): Promise<Lead | null> {
    return (
      this.leads.find(
        (l) => l.business_id === businessId && l.conversation_id === conversationId,
      ) ?? null
    );
  }

  async getLead(businessId: string, leadId: string): Promise<Lead | null> {
    return this.leads.find((l) => l.id === leadId && l.business_id === businessId) ?? null;
  }

  async createLead(input: CreateLeadInput): Promise<Lead> {
    const existing = await this.getLeadByConversation(input.businessId, input.conversationId);
    if (existing) return existing;
    const lead: Lead = {
      id: randomUUID(),
      business_id: input.businessId,
      customer_id: input.customerId,
      conversation_id: input.conversationId,
      status: input.status ?? 'new',
      temperature: 'low',
      lead_score: 0,
      intent: input.intent ?? 'unknown',
      estimated_value: null,
      expected_check_in: null,
      expected_check_out: null,
      guests: null,
      room_preference: null,
      source: input.source ?? 'whatsapp',
      assigned_staff_id: null,
      follow_ups_sent: 0,
      last_customer_message_at: input.lastCustomerMessageAt ?? null,
      last_response_at: null,
      next_follow_up_at: null,
      converted_at: null,
      conversion_value: null,
      lost_at: null,
      loss_reason: null,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.leads.push(lead);
    return lead;
  }

  async updateLead(businessId: string, leadId: string, patch: Partial<Lead>): Promise<Lead> {
    const lead = await this.getLead(businessId, leadId);
    if (!lead) throw new Error(`lead ${leadId} not found for business ${businessId}`);
    Object.assign(lead, patch, { updated_at: this.now() });
    return lead;
  }

  async insertLeadEvent(input: InsertLeadEventInput): Promise<LeadEvent> {
    const event: LeadEvent = {
      id: randomUUID(),
      business_id: input.businessId,
      lead_id: input.leadId,
      type: input.type,
      actor_type: input.actorType ?? 'system',
      actor_user_id: input.actorUserId ?? null,
      data: input.data ?? {},
      created_at: this.now(),
    };
    this.leadEvents.push(event);
    return event;
  }

  async listFollowUpRules(businessId: string): Promise<FollowUpRule[]> {
    return this.followUpRules
      .filter((r) => r.business_id === businessId)
      .sort((a, b) => a.sequence_index - b.sequence_index);
  }

  async getFollowUp(businessId: string, followUpId: string): Promise<FollowUp | null> {
    return (
      this.followUps.find((f) => f.id === followUpId && f.business_id === businessId) ?? null
    );
  }

  async listFollowUpsForLead(businessId: string, leadId: string): Promise<FollowUp[]> {
    return this.followUps.filter((f) => f.business_id === businessId && f.lead_id === leadId);
  }

  async findFollowUpByDedupeKey(businessId: string, dedupeKey: string): Promise<FollowUp | null> {
    return (
      this.followUps.find((f) => f.business_id === businessId && f.dedupe_key === dedupeKey) ?? null
    );
  }

  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
    const existing = await this.findFollowUpByDedupeKey(input.businessId, input.dedupeKey);
    if (existing) return existing;
    const followUp: FollowUp = {
      id: randomUUID(),
      business_id: input.businessId,
      lead_id: input.leadId,
      conversation_id: input.conversationId,
      rule_id: input.ruleId,
      sequence_index: input.sequenceIndex,
      status: 'scheduled',
      scheduled_for: input.scheduledFor,
      sent_at: null,
      cancelled_at: null,
      cancel_reason: null,
      message_id: null,
      body: input.body,
      attempts: 0,
      last_error: null,
      created_by: input.createdBy ?? 'system',
      dedupe_key: input.dedupeKey,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.followUps.push(followUp);
    return followUp;
  }

  async updateFollowUp(
    businessId: string,
    followUpId: string,
    patch: Partial<FollowUp>,
  ): Promise<void> {
    const followUp = this.followUps.find(
      (f) => f.id === followUpId && f.business_id === businessId,
    );
    if (followUp) Object.assign(followUp, patch, { updated_at: this.now() });
  }

  async cancelScheduledFollowUps(
    businessId: string,
    leadId: string,
    reason: string,
  ): Promise<FollowUp[]> {
    const cancelled = this.followUps.filter(
      (f) => f.business_id === businessId && f.lead_id === leadId && f.status === 'scheduled',
    );
    for (const followUp of cancelled) {
      followUp.status = 'cancelled';
      followUp.cancelled_at = this.now();
      followUp.cancel_reason = reason;
    }
    return cancelled;
  }

  async listDueFollowUps(now: Date, limit = 100): Promise<FollowUp[]> {
    return this.followUps
      .filter((f) => f.status === 'scheduled' && new Date(f.scheduled_for) <= now)
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
      .slice(0, limit);
  }

  async listRoomAvailability(
    businessId: string,
    from: string,
    to: string,
  ): Promise<RoomAvailability[]> {
    return this.roomAvailability.filter(
      (row) => row.business_id === businessId && row.date >= from && row.date < to,
    );
  }

  async listBookings(businessId: string, from: string, to: string): Promise<Booking[]> {
    return this.bookings.filter(
      (booking) =>
        booking.business_id === businessId &&
        booking.status === 'confirmed' &&
        booking.check_in < to &&
        booking.check_out > from,
    );
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const booking: Booking = {
      id: randomUUID(),
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      customer_id: input.customerId,
      room_id: input.roomId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      units: input.units ?? 1,
      guests: input.guests ?? null,
      status: 'confirmed',
      total_value: input.totalValue ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.bookings.push(booking);
    return booking;
  }

  async insertAiAction(input: InsertAiActionInput): Promise<AiAction> {
    const action: AiAction = {
      id: randomUUID(),
      business_id: input.businessId,
      conversation_id: input.conversationId,
      lead_id: input.leadId ?? null,
      inbound_message_id: input.inboundMessageId ?? null,
      outbound_message_id: input.outboundMessageId ?? null,
      provider: input.provider,
      model: input.model ?? null,
      intent: input.intent ?? null,
      confidence: input.confidence ?? null,
      requires_human: input.requiresHuman ?? false,
      requires_follow_up: input.requiresFollowUp ?? false,
      suggested_action: input.suggestedAction ?? null,
      entities: input.entities ?? {},
      decision: input.decision,
      guardrail_flags: input.guardrailFlags ?? [],
      latency_ms: input.latencyMs ?? null,
      error: input.error ?? null,
      created_at: this.now(),
    };
    this.aiActions.push(action);
    return action;
  }

  async insertAnalyticsEvent(input: InsertAnalyticsEventInput): Promise<AnalyticsEvent> {
    const event: AnalyticsEvent = {
      id: randomUUID(),
      business_id: input.businessId,
      type: input.type,
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null,
      value: input.value ?? null,
      data: input.data ?? {},
      occurred_at: input.occurredAt ?? this.now(),
    };
    this.analyticsEvents.push(event);
    return event;
  }

  async getWhatsAppIntegration(businessId: string): Promise<WhatsAppIntegrationSecrets | null> {
    return this.integrations.get(businessId) ?? null;
  }

  async getWhatsAppTemplate(businessId: string, purpose: string): Promise<WhatsAppTemplate | null> {
    return (
      this.templates.find((t) => t.business_id === businessId && t.purpose === purpose) ?? null
    );
  }

  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<{ isNew: boolean }> {
    const key = `${input.provider}:${input.providerEventId}`;
    if (this.webhookEvents.has(key)) return { isNew: false };
    this.webhookEvents.set(key, { status: 'received' });
    return { isNew: true };
  }

  async markWebhookEventProcessed(
    providerEventId: string,
    status: 'processed' | 'failed',
    error?: string,
  ): Promise<void> {
    for (const [key, value] of this.webhookEvents) {
      if (key.endsWith(`:${providerEventId}`)) {
        value.status = status;
        if (error) value.error = error;
      }
    }
  }
}
