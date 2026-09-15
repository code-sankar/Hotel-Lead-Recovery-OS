import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  countOpenWork,
  getConversationDetail,
  listConversations,
  listFollowUps,
  listLeads,
  listTeamMembers,
} from '@/lib/db/queries';
import { storeForBusiness } from '@/lib/db/user-store';
import { checkAvailability } from '@/lib/availability/service';
import { hashInviteToken } from '@/lib/team/tokens';
import { clientFor, isConfigured, startSupabaseShim, serviceToken, userToken } from './harness';

/**
 * Exercises the PostgREST layer for real: the embeds, the filters, the RPC
 * argument names and the security views. Skipped unless LEADSTAY_PGRST_URL
 * points at a PostgREST instance over the project's schema — see
 * `npm run test:integration`.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const STAFF = '33333333-3333-4333-8333-333333333333';

describe.skipIf(!isConfigured)('PostgREST layer', () => {
  let shim: { url: string; close: () => Promise<void> };
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let businessId: string;
  let conversationId: string;

  /** Surfaces a PostgREST error instead of failing later on a null. */
  // The client has no generated Database types here, so `data` comes back as
  // `never`; the caller states the shape it expects at the boundary.
  function must<T>(
    result: { data: unknown; error: { message: string } | null },
    what: string,
  ): T {
    if (result.error) throw new Error(`${what}: ${result.error.message}`);
    if (result.data === null || result.data === undefined) {
      throw new Error(`${what}: returned no row`);
    }
    return result.data as T;
  }

  type Row = { id: string };

  beforeAll(async () => {
    shim = await startSupabaseShim();
    service = clientFor(shim.url, serviceToken());
    owner = clientFor(shim.url, userToken(OWNER));

    // Provisioning goes through the same RPC the onboarding form calls, which
    // also proves the argument names match.
    const asOwner = clientFor(shim.url, userToken(OWNER));
    const { data, error } = await asOwner.rpc('create_business_with_owner', {
      business_name: 'PostgREST Hotel',
      business_timezone: 'Asia/Kolkata',
      business_currency: 'INR',
    });
    if (error) throw new Error(`create_business_with_owner failed: ${error.message}`);
    businessId = String(data);

    // Enough data for every embed to have something to join.
    const customerId = must<Row>(
      await service
        .from('customers')
        .insert({ business_id: businessId, phone_number: '919810000101', name: 'Rahul Sharma' })
        .select('id')
        .single(),
      'insert customer',
    ).id;

    const conversationRow = must<Row>(
      await service
      .from('conversations')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        last_message_at: new Date().toISOString(),
        last_message_preview: 'Do you have rooms?',
        unread_count: 2,
      })
      .select('id')
      .single(),
      'insert conversation',
    );
    conversationId = conversationRow.id;

    const leadRow = must<Row>(
      await service
      .from('leads')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        conversation_id: conversationId,
        status: 'hot',
        temperature: 'hot',
        lead_score: 85,
        intent: 'booking_intent',
        estimated_value: 5600,
        expected_check_in: '2026-10-15',
        expected_check_out: '2026-10-17',
        guests: 2,
        assigned_staff_id: OWNER,
        next_follow_up_at: new Date(Date.now() + 3600_000).toISOString(),
      })
      .select('id')
      .single(),
      'insert lead',
    );
    const leadId = leadRow.id;

    await service.from('messages').insert([
      { business_id: businessId, conversation_id: conversationId, direction: 'inbound', sender_type: 'customer', text: 'Do you have rooms?' },
      { business_id: businessId, conversation_id: conversationId, direction: 'outbound', sender_type: 'ai', text: 'Yes — which dates?', ai_model: 'rules-v1' },
    ]);
    await service.from('staff_notes').insert({
      business_id: businessId, lead_id: leadId, conversation_id: conversationId,
      author_id: OWNER, body: 'Called, no answer.',
    });
    await service.from('lead_events').insert({
      business_id: businessId, lead_id: leadId, type: 'lead_created', data: {},
    });

    const rule = must<Row>(
      await service.from('follow_up_rules').select('id').eq('business_id', businessId).eq('sequence_index', 1).single(),
      'read seeded follow-up rule',
    );

    await service.from('follow_ups').insert({
      business_id: businessId, lead_id: leadId, conversation_id: conversationId,
      rule_id: rule.id, sequence_index: 1,
      scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      body: 'Just checking in.', dedupe_key: `lead:${leadId}:seq:1:r0`,
    });

    const room = must<Row>(
      await service
        .from('rooms')
        .insert({ business_id: businessId, name: 'Deluxe Room', base_price: 2800, max_guests: 2, total_units: 4 })
        .select('id')
        .single(),
      'insert room',
    );
    await service.from('room_availability').insert({
      business_id: businessId, room_id: room.id,
      date: '2026-10-16', units_available: 1, closed: false,
    });
    await service.from('bookings').insert({
      business_id: businessId, customer_id: customerId, room_id: room.id,
      check_in: '2026-10-15', check_out: '2026-10-16', units: 2,
    });
  }, 30_000);

  afterAll(async () => {
    await shim?.close();
  });

  // --- embeds -------------------------------------------------------------

  it('listConversations resolves the customers!inner and leads embeds', async () => {
    const items = await listConversations(businessId, {}, owner);
    expect(items).toHaveLength(1);
    expect(items[0]!.customer.name).toBe('Rahul Sharma');
    // A one-to-many embed comes back as an array; the code must unwrap it.
    expect(items[0]!.lead?.temperature).toBe('hot');
    expect(items[0]!.conversation.unread_count).toBe(2);
  });

  it('listConversations applies the mode filter server-side', async () => {
    expect(await listConversations(businessId, { mode: 'ai' }, owner)).toHaveLength(1);
    expect(await listConversations(businessId, { mode: 'human' }, owner)).toHaveLength(0);
  });

  it('getConversationDetail assembles messages, lead, events, notes and follow-ups', async () => {
    const detail = await getConversationDetail(businessId, conversationId, owner);
    expect(detail).not.toBeNull();
    expect(detail!.messages).toHaveLength(2);
    expect(detail!.lead?.lead_score).toBe(85);
    expect(detail!.events.length).toBeGreaterThan(0);
    expect(detail!.followUps).toHaveLength(1);
    // Author comes from the separate profile lookup, not an embed.
    expect(detail!.notes[0]!.author?.full_name ?? detail!.notes[0]!.author).toBeDefined();
  });

  it('listLeads embeds the customer and resolves the assignee separately', async () => {
    const leads = await listLeads(businessId, {}, owner);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.customer.phone_number).toBe('919810000101');
    expect(leads[0]!.assignee).not.toBeNull();
  });

  it('listLeads honours every sort option PostgREST has to accept', async () => {
    for (const sort of ['newest', 'score', 'value', 'follow_up'] as const) {
      const leads = await listLeads(businessId, { sort }, owner);
      expect(leads).toHaveLength(1);
    }
  });

  it('listLeads handles the follow_up_due filter, which combines not-null with in()', async () => {
    expect(await listLeads(businessId, { status: 'follow_up_due' }, owner)).toHaveLength(1);
    expect(await listLeads(businessId, { status: 'converted' }, owner)).toHaveLength(0);
    expect(await listLeads(businessId, { temperature: 'hot' }, owner)).toHaveLength(1);
    expect(await listLeads(businessId, { temperature: 'cold' }, owner)).toHaveLength(0);
  });

  it('listFollowUps resolves leads!inner and the nullable rule embed', async () => {
    const followUps = await listFollowUps(businessId, 'scheduled', owner);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]!.lead.temperature).toBe('hot');
    expect(followUps[0]!.rule?.name).toContain('follow-up');
    expect(followUps[0]!.customer.name).toBe('Rahul Sharma');
  });

  it('listTeamMembers joins profiles across the auth.users boundary', async () => {
    const members = await listTeamMembers(businessId, owner);
    expect(members).toHaveLength(1);
    expect(members[0]!.role).toBe('owner');
    expect(members[0]!.profile?.email).toBeTruthy();
  });

  it('countOpenWork runs three head-count queries', async () => {
    const counts = await countOpenWork(businessId, owner);
    expect(counts.conversations).toBe(1);
    expect(counts.followUpsDue).toBe(1);
    expect(counts.openIssues).toBe(0);
  });

  // --- availability reads --------------------------------------------------

  it('the session-scoped store reads overrides and bookings for a stay', async () => {
    const snapshot = await checkAvailability(
      storeForBusiness(owner),
      businessId,
      [{ id: 'unused', name: 'x', basePrice: 0, maxGuests: 2, totalUnits: 4 }],
      { checkIn: '2026-10-15', checkOut: '2026-10-17' },
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nights).toBe(2);
  });

  // --- RPCs ----------------------------------------------------------------

  it('record_system_event accepts its named arguments and returns a row', async () => {
    const { data, error } = await service.rpc('record_system_event', {
      target_business_id: businessId,
      event_level: 'error',
      event_scope: 'followup.send',
      event_message: 'A follow-up could not be sent.',
      event_fingerprint: 'fp-integration',
      event_detail: { k: 1 },
      alert_eligible: true,
      alert_cooldown_minutes: 60,
    });
    expect(error).toBeNull();
    const row = (Array.isArray(data) ? data[0] : data) as {
      should_alert: boolean;
      occurrences: number;
      is_new: boolean;
    };
    expect(row.should_alert).toBe(true);
    expect(row.occurrences).toBe(1);
    expect(row.is_new).toBe(true);
  });

  it('the invite RPCs work through PostgREST', async () => {
    // Unique per run: token_hash is unique, so a fixed value would silently
    // collide with a previous run's already-accepted invite.
    const token = randomBytes(32).toString('hex');
    must<Row>(
      await service.from('business_invites').insert({
      business_id: businessId,
      email: 'staff-a@example.com',
      role: 'staff',
      token_hash: hashInviteToken(token),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
        .select('id')
        .single(),
      'insert invite',
    );

    const anyone = clientFor(shim.url, userToken(STAFF));
    const { data: preview, error: previewError } = await anyone.rpc('preview_business_invite', {
      invite_token_hash: hashInviteToken(token),
    });
    expect(previewError).toBeNull();
    const row = (Array.isArray(preview) ? preview[0] : preview) as { business_name: string; status: string };
    expect(row.business_name).toBe('PostgREST Hotel');
    expect(row.status).toBe('pending');

    const { data: joined, error: acceptError } = await anyone.rpc('accept_business_invite', {
      invite_token_hash: hashInviteToken(token),
    });
    expect(acceptError).toBeNull();
    expect(String(joined)).toBe(businessId);
  });

  // --- security views ------------------------------------------------------

  it('exposes WhatsApp status without the credentials', async () => {
    const { data, error } = await owner
      .from('whatsapp_integration_status')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Object.keys(data as object)).not.toContain('access_token');
    expect(data).toHaveProperty('has_access_token');
  });

  it('refuses the underlying credential tables outright', async () => {
    const wa = await owner.from('whatsapp_integrations').select('access_token');
    expect(wa.error).not.toBeNull();
    const alerts = await owner.from('alert_channels').select('webhook_url');
    expect(alerts.error).not.toBeNull();
  });

  // --- tenant isolation, over HTTP ----------------------------------------

  it('a signed-in stranger sees none of this hotel', async () => {
    const stranger = clientFor(shim.url, userToken('99999999-9999-4999-8999-999999999999'));
    expect(await listConversations(businessId, {}, stranger)).toHaveLength(0);
    expect(await listLeads(businessId, {}, stranger)).toHaveLength(0);
    expect(await getConversationDetail(businessId, conversationId, stranger)).toBeNull();
  });
});
