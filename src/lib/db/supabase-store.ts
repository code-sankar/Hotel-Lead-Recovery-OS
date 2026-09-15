import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AiAction,
  AnalyticsEvent,
  Booking,
  Business,
  BusinessProfile,
  BusinessSettings,
  Conversation,
  Customer,
  FollowUp,
  FollowUpRule,
  HotelFaq,
  HotelPolicy,
  Lead,
  LeadEvent,
  Message,
  Room,
  RoomAvailability,
  WhatsAppIntegrationSecrets,
  WhatsAppTemplate,
} from '@/types/domain';
import type { HotelKnowledge } from '@/lib/knowledge/types';
import { createServiceSupabase } from './service-client';
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
} from './store';

/**
 * Supabase implementation of the Store port, running with the service role.
 *
 * RLS does not apply here, so tenant scoping is explicit: every query filters
 * on business_id, and every write sets it. Read paths that serve the UI use the
 * user-session client instead, where RLS is the guard.
 */
export class SupabaseStore implements Store {
  constructor(private readonly client: SupabaseClient = createServiceSupabase()) {}

  // --- tenant resolution ---------------------------------------------------

  async findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    const { data, error } = await this.client
      .from('whatsapp_integrations')
      .select('business_id')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle();
    if (error) throw dbError('findBusinessByPhoneNumberId', error);
    if (!data) return null;
    return this.getBusiness(data.business_id as string);
  }

  async getBusiness(businessId: string): Promise<Business | null> {
    const { data, error } = await this.client
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw dbError('getBusiness', error);
    return (data as Business | null) ?? null;
  }

  // --- hotel knowledge -----------------------------------------------------

  async loadKnowledge(businessId: string): Promise<HotelKnowledge | null> {
    const [business, profile, rooms, policies, faqs, settings] = await Promise.all([
      this.getBusiness(businessId),
      this.selectMaybe<BusinessProfile>('business_profiles', businessId, 'business_id'),
      this.listRooms(businessId),
      this.listPolicies(businessId),
      this.listFaqs(businessId),
      this.getSettings(businessId),
    ]);

    if (!business || !settings) return null;

    return {
      business: {
        id: business.id,
        name: business.name,
        address: business.address,
        city: business.city,
        state: business.state,
        phone: business.phone,
        website: business.website,
        currency: business.currency,
        timezone: business.timezone,
      },
      profile: {
        description: profile?.description ?? null,
        locationNote: profile?.location_note ?? null,
        checkInTime: profile?.check_in_time ?? null,
        checkOutTime: profile?.check_out_time ?? null,
        amenities: profile?.amenities ?? [],
        businessHours: profile?.business_hours ?? {},
        landmarks: profile?.landmarks ?? null,
      },
      rooms: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        description: room.description,
        basePrice: Number(room.base_price),
        maxGuests: room.max_guests,
        amenities: room.amenities ?? [],
        breakfastIncluded: room.breakfast_included,
        notes: room.notes,
        totalUnits: room.total_units,
      })),
      policies: policies.map((policy) => ({
        type: policy.type,
        title: policy.title,
        content: policy.content,
      })),
      faqs: faqs.map((faq) => ({ question: faq.question, answer: faq.answer })),
      settings: {
        aiTone: settings.ai_tone,
        aiWelcomeMessage: settings.ai_welcome_message,
        aiEscalationMessage: settings.ai_escalation_message,
      },
    };
  }

  async getSettings(businessId: string): Promise<BusinessSettings | null> {
    return this.selectMaybe<BusinessSettings>('business_settings', businessId, 'business_id');
  }

  // --- customers -----------------------------------------------------------

  async findOrCreateCustomer(input: FindOrCreateCustomerInput): Promise<Customer> {
    const { data: existing, error: selectError } = await this.client
      .from('customers')
      .select('*')
      .eq('business_id', input.businessId)
      .eq('phone_number', input.phoneNumber)
      .maybeSingle();
    if (selectError) throw dbError('findOrCreateCustomer.select', selectError);

    if (existing) {
      const customer = existing as Customer;
      // Fill in a name the first time WhatsApp gives us one.
      if (!customer.name && input.name) {
        await this.updateCustomer(input.businessId, customer.id, { name: input.name });
        customer.name = input.name;
      }
      return customer;
    }

    const { data, error } = await this.client
      .from('customers')
      .insert({
        business_id: input.businessId,
        phone_number: input.phoneNumber,
        name: input.name ?? null,
      })
      .select('*')
      .single();

    if (error) {
      // A concurrent webhook may have inserted the same customer first.
      if (error.code === '23505') {
        const { data: raced } = await this.client
          .from('customers')
          .select('*')
          .eq('business_id', input.businessId)
          .eq('phone_number', input.phoneNumber)
          .single();
        if (raced) return raced as Customer;
      }
      throw dbError('findOrCreateCustomer.insert', error);
    }
    return data as Customer;
  }

  async getCustomer(businessId: string, customerId: string): Promise<Customer | null> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', customerId)
      .maybeSingle();
    if (error) throw dbError('getCustomer', error);
    return (data as Customer | null) ?? null;
  }

  async updateCustomer(
    businessId: string,
    customerId: string,
    patch: Partial<Customer>,
  ): Promise<void> {
    const { error } = await this.client
      .from('customers')
      .update(patch)
      .eq('business_id', businessId)
      .eq('id', customerId);
    if (error) throw dbError('updateCustomer', error);
  }

  // --- conversations -------------------------------------------------------

  async findOrCreateConversation(businessId: string, customerId: string): Promise<Conversation> {
    const { data: existing, error: selectError } = await this.client
      .from('conversations')
      .select('*')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectError) throw dbError('findOrCreateConversation.select', selectError);
    if (existing) return existing as Conversation;

    const { data, error } = await this.client
      .from('conversations')
      .insert({ business_id: businessId, customer_id: customerId })
      .select('*')
      .single();
    if (error) throw dbError('findOrCreateConversation.insert', error);
    return data as Conversation;
  }

  async getConversation(businessId: string, conversationId: string): Promise<Conversation | null> {
    const { data, error } = await this.client
      .from('conversations')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw dbError('getConversation', error);
    return (data as Conversation | null) ?? null;
  }

  async updateConversation(
    businessId: string,
    conversationId: string,
    patch: Partial<Conversation>,
  ): Promise<void> {
    const { error } = await this.client
      .from('conversations')
      .update(patch)
      .eq('business_id', businessId)
      .eq('id', conversationId);
    if (error) throw dbError('updateConversation', error);
  }

  // --- messages ------------------------------------------------------------

  async findMessageByProviderId(
    businessId: string,
    providerMessageId: string,
  ): Promise<Message | null> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('business_id', businessId)
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();
    if (error) throw dbError('findMessageByProviderId', error);
    return (data as Message | null) ?? null;
  }

  async insertMessage(input: InsertMessageInput): Promise<Message> {
    const { data, error } = await this.client
      .from('messages')
      .insert({
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
      })
      .select('*')
      .single();

    if (error) {
      // Unique violation on (business_id, provider_message_id): the message is
      // already stored, so return the stored row rather than failing the job.
      if (error.code === '23505' && input.providerMessageId) {
        const existing = await this.findMessageByProviderId(
          input.businessId,
          input.providerMessageId,
        );
        if (existing) return existing;
      }
      throw dbError('insertMessage', error);
    }
    return data as Message;
  }

  async updateMessage(
    businessId: string,
    messageId: string,
    patch: Partial<Message>,
  ): Promise<void> {
    const { error } = await this.client
      .from('messages')
      .update(patch)
      .eq('business_id', businessId)
      .eq('id', messageId);
    if (error) throw dbError('updateMessage', error);
  }

  async listMessages(
    businessId: string,
    conversationId: string,
    limit = 50,
  ): Promise<Message[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('business_id', businessId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw dbError('listMessages', error);
    return ((data ?? []) as Message[]).reverse();
  }

  // --- leads ---------------------------------------------------------------

  async getLeadByConversation(businessId: string, conversationId: string): Promise<Lead | null> {
    const { data, error } = await this.client
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (error) throw dbError('getLeadByConversation', error);
    return (data as Lead | null) ?? null;
  }

  async getLead(businessId: string, leadId: string): Promise<Lead | null> {
    const { data, error } = await this.client
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', leadId)
      .maybeSingle();
    if (error) throw dbError('getLead', error);
    return (data as Lead | null) ?? null;
  }

  async createLead(input: CreateLeadInput): Promise<Lead> {
    const { data, error } = await this.client
      .from('leads')
      .insert({
        business_id: input.businessId,
        customer_id: input.customerId,
        conversation_id: input.conversationId,
        status: input.status ?? 'new',
        intent: input.intent ?? 'unknown',
        source: input.source ?? 'whatsapp',
        last_customer_message_at: input.lastCustomerMessageAt ?? null,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        const existing = await this.getLeadByConversation(input.businessId, input.conversationId);
        if (existing) return existing;
      }
      throw dbError('createLead', error);
    }
    return data as Lead;
  }

  async updateLead(businessId: string, leadId: string, patch: Partial<Lead>): Promise<Lead> {
    const { data, error } = await this.client
      .from('leads')
      .update(patch)
      .eq('business_id', businessId)
      .eq('id', leadId)
      .select('*')
      .single();
    if (error) throw dbError('updateLead', error);
    return data as Lead;
  }

  async insertLeadEvent(input: InsertLeadEventInput): Promise<LeadEvent> {
    const { data, error } = await this.client
      .from('lead_events')
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        type: input.type,
        actor_type: input.actorType ?? 'system',
        actor_user_id: input.actorUserId ?? null,
        data: input.data ?? {},
      })
      .select('*')
      .single();
    if (error) throw dbError('insertLeadEvent', error);
    return data as LeadEvent;
  }

  async listFollowUpRules(businessId: string): Promise<FollowUpRule[]> {
    const { data, error } = await this.client
      .from('follow_up_rules')
      .select('*')
      .eq('business_id', businessId)
      .order('sequence_index', { ascending: true });
    if (error) throw dbError('listFollowUpRules', error);
    return (data ?? []) as FollowUpRule[];
  }

  async getFollowUp(businessId: string, followUpId: string): Promise<FollowUp | null> {
    const { data, error } = await this.client
      .from('follow_ups')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', followUpId)
      .maybeSingle();
    if (error) throw dbError('getFollowUp', error);
    return (data as FollowUp | null) ?? null;
  }

  async listFollowUpsForLead(businessId: string, leadId: string): Promise<FollowUp[]> {
    const { data, error } = await this.client
      .from('follow_ups')
      .select('*')
      .eq('business_id', businessId)
      .eq('lead_id', leadId)
      .order('sequence_index', { ascending: true });
    if (error) throw dbError('listFollowUpsForLead', error);
    return (data ?? []) as FollowUp[];
  }

  async findFollowUpByDedupeKey(businessId: string, dedupeKey: string): Promise<FollowUp | null> {
    const { data, error } = await this.client
      .from('follow_ups')
      .select('*')
      .eq('business_id', businessId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (error) throw dbError('findFollowUpByDedupeKey', error);
    return (data as FollowUp | null) ?? null;
  }

  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
    const { data, error } = await this.client
      .from('follow_ups')
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        conversation_id: input.conversationId,
        rule_id: input.ruleId,
        sequence_index: input.sequenceIndex,
        scheduled_for: input.scheduledFor,
        body: input.body,
        dedupe_key: input.dedupeKey,
        created_by: input.createdBy ?? 'system',
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') {
        const existing = await this.findFollowUpByDedupeKey(input.businessId, input.dedupeKey);
        if (existing) return existing;
      }
      throw dbError('createFollowUp', error);
    }
    return data as FollowUp;
  }

  async updateFollowUp(
    businessId: string,
    followUpId: string,
    patch: Partial<FollowUp>,
  ): Promise<void> {
    const { error } = await this.client
      .from('follow_ups')
      .update(patch)
      .eq('business_id', businessId)
      .eq('id', followUpId);
    if (error) throw dbError('updateFollowUp', error);
  }

  async cancelScheduledFollowUps(
    businessId: string,
    leadId: string,
    reason: string,
  ): Promise<FollowUp[]> {
    const { data, error } = await this.client
      .from('follow_ups')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
      })
      .eq('business_id', businessId)
      .eq('lead_id', leadId)
      .eq('status', 'scheduled')
      .select('*');
    if (error) throw dbError('cancelScheduledFollowUps', error);
    return (data ?? []) as FollowUp[];
  }

  async listDueFollowUps(now: Date, limit = 100): Promise<FollowUp[]> {
    const { data, error } = await this.client
      .from('follow_ups')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now.toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(limit);
    if (error) throw dbError('listDueFollowUps', error);
    return (data ?? []) as FollowUp[];
  }

  // --- availability --------------------------------------------------------

  async listRoomAvailability(
    businessId: string,
    from: string,
    to: string,
  ): Promise<RoomAvailability[]> {
    const { data, error } = await this.client
      .from('room_availability')
      .select('*')
      .eq('business_id', businessId)
      .gte('date', from)
      .lt('date', to);
    if (error) throw dbError('listRoomAvailability', error);
    return (data ?? []) as RoomAvailability[];
  }

  async listBookings(businessId: string, from: string, to: string): Promise<Booking[]> {
    // Overlap test: a stay touches the window when it starts before the window
    // ends and finishes after the window starts.
    const { data, error } = await this.client
      .from('bookings')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'confirmed')
      .lt('check_in', to)
      .gt('check_out', from);
    if (error) throw dbError('listBookings', error);
    return (data ?? []) as Booking[];
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const { data, error } = await this.client
      .from('bookings')
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId ?? null,
        customer_id: input.customerId,
        room_id: input.roomId,
        check_in: input.checkIn,
        check_out: input.checkOut,
        units: input.units ?? 1,
        guests: input.guests ?? null,
        total_value: input.totalValue ?? null,
        notes: input.notes ?? null,
        created_by: input.createdBy ?? null,
      })
      .select('*')
      .single();
    if (error) throw dbError('createBooking', error);
    return data as Booking;
  }

  // --- telemetry -----------------------------------------------------------

  async insertAiAction(input: InsertAiActionInput): Promise<AiAction> {
    const { data, error } = await this.client
      .from('ai_actions')
      .insert({
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
      })
      .select('*')
      .single();
    if (error) throw dbError('insertAiAction', error);
    return data as AiAction;
  }

  async insertAnalyticsEvent(input: InsertAnalyticsEventInput): Promise<AnalyticsEvent> {
    const { data, error } = await this.client
      .from('analytics_events')
      .insert({
        business_id: input.businessId,
        type: input.type,
        lead_id: input.leadId ?? null,
        conversation_id: input.conversationId ?? null,
        value: input.value ?? null,
        data: input.data ?? {},
        occurred_at: input.occurredAt ?? new Date().toISOString(),
      })
      .select('*')
      .single();
    if (error) throw dbError('insertAnalyticsEvent', error);
    return data as AnalyticsEvent;
  }

  // --- provider plumbing ---------------------------------------------------

  async getWhatsAppIntegration(businessId: string): Promise<WhatsAppIntegrationSecrets | null> {
    const { data, error } = await this.client
      .from('whatsapp_integrations')
      .select('business_id, phone_number_id, display_phone_number, waba_id, access_token, app_secret, verify_token, status')
      .eq('business_id', businessId)
      .maybeSingle();
    if (error) throw dbError('getWhatsAppIntegration', error);
    return (data as WhatsAppIntegrationSecrets | null) ?? null;
  }

  async getWhatsAppTemplate(businessId: string, purpose: string): Promise<WhatsAppTemplate | null> {
    const { data, error } = await this.client
      .from('whatsapp_templates')
      .select('*')
      .eq('business_id', businessId)
      .eq('purpose', purpose)
      .maybeSingle();
    if (error) throw dbError('getWhatsAppTemplate', error);
    return (data as WhatsAppTemplate | null) ?? null;
  }

  async recordWebhookEvent(input: RecordWebhookEventInput): Promise<{ isNew: boolean }> {
    const { error } = await this.client.from('webhook_events').insert({
      provider: input.provider,
      provider_event_id: input.providerEventId,
      business_id: input.businessId ?? null,
      payload: input.payload ?? null,
    });
    if (error) {
      if (error.code === '23505') return { isNew: false };
      throw dbError('recordWebhookEvent', error);
    }
    return { isNew: true };
  }

  async markWebhookEventProcessed(
    providerEventId: string,
    status: 'processed' | 'failed',
    error?: string,
  ): Promise<void> {
    const { error: updateError } = await this.client
      .from('webhook_events')
      .update({ status, error: error ?? null, processed_at: new Date().toISOString() })
      .eq('provider_event_id', providerEventId);
    if (updateError) throw dbError('markWebhookEventProcessed', updateError);
  }

  // --- helpers -------------------------------------------------------------

  private async selectMaybe<T>(table: string, id: string, column: string): Promise<T | null> {
    const { data, error } = await this.client.from(table).select('*').eq(column, id).maybeSingle();
    if (error) throw dbError(`select ${table}`, error);
    return (data as T | null) ?? null;
  }

  private async listRooms(businessId: string): Promise<Room[]> {
    const { data, error } = await this.client
      .from('rooms')
      .select('*')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw dbError('listRooms', error);
    return (data ?? []) as Room[];
  }

  private async listPolicies(businessId: string): Promise<HotelPolicy[]> {
    const { data, error } = await this.client
      .from('hotel_policies')
      .select('*')
      .eq('business_id', businessId)
      .eq('active', true);
    if (error) throw dbError('listPolicies', error);
    return (data ?? []) as HotelPolicy[];
  }

  private async listFaqs(businessId: string): Promise<HotelFaq[]> {
    const { data, error } = await this.client
      .from('hotel_faqs')
      .select('*')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw dbError('listFaqs', error);
    return (data ?? []) as HotelFaq[];
  }
}

interface PostgrestErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Keeps the failing operation in the message without leaking connection details. */
function dbError(operation: string, error: PostgrestErrorLike): Error {
  return new Error(`[db] ${operation} failed: ${error.message}${error.code ? ` (${error.code})` : ''}`);
}

let cachedStore: SupabaseStore | null = null;

export function getServiceStore(): SupabaseStore {
  if (!cachedStore) cachedStore = new SupabaseStore();
  return cachedStore;
}
