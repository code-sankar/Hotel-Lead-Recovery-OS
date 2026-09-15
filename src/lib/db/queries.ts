import 'server-only';

import type {
  Conversation,
  Customer,
  FollowUp,
  FollowUpRule,
  Lead,
  LeadEvent,
  Message,
  Profile,
  StaffNote,
} from '@/types/domain';
import { createServerSupabase } from './server-client';

/**
 * Read models for the UI.
 *
 * These run on the signed-in user's session, so Row Level Security is the
 * enforcing boundary. The explicit business_id filters are defence in depth and
 * keep the intent of each query obvious.
 */


type ProfileSummary = Pick<Profile, 'id' | 'full_name' | 'email'>;

/**
 * Loads profiles by user id.
 *
 * Columns like leads.assigned_staff_id and staff_notes.author_id reference
 * auth.users, so PostgREST has no relationship to embed public.profiles across.
 * One extra query keeps the read models correct without reshaping the schema.
 */
async function loadProfiles(ids: Array<string | null>): Promise<Map<string, ProfileSummary>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const supabase = await createServerSupabase();
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unique);
  return new Map(((data ?? []) as ProfileSummary[]).map((profile) => [profile.id, profile]));
}

export interface ConversationListItem {
  conversation: Conversation;
  customer: Pick<Customer, 'id' | 'name' | 'phone_number' | 'opted_out'>;
  lead: Pick<Lead, 'id' | 'status' | 'temperature' | 'lead_score' | 'intent' | 'next_follow_up_at'> | null;
}

export async function listConversations(
  businessId: string,
  options: { search?: string; mode?: string; limit?: number } = {},
): Promise<ConversationListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from('conversations')
    .select(
      'id, business_id, customer_id, mode, status, channel, assigned_staff_id, taken_over_by, taken_over_at, last_inbound_at, last_outbound_at, last_message_at, last_message_preview, unread_count, created_at, updated_at, customers!inner(id, name, phone_number, opted_out), leads(id, status, temperature, lead_score, intent, next_follow_up_at)',
    )
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 100);

  if (options.mode && options.mode !== 'all') query = query.eq('mode', options.mode);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load conversations: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<
    Conversation & {
      customers: ConversationListItem['customer'];
      leads: ConversationListItem['lead'][] | ConversationListItem['lead'] | null;
    }
  >;

  const items = rows.map((row) => {
    const { customers, leads, ...conversation } = row;
    return {
      conversation: conversation as Conversation,
      customer: customers,
      lead: Array.isArray(leads) ? (leads[0] ?? null) : leads,
    };
  });

  const search = options.search?.trim().toLowerCase();
  if (!search) return items;
  return items.filter(
    (item) =>
      item.customer.name?.toLowerCase().includes(search) ||
      item.customer.phone_number.includes(search) ||
      item.conversation.last_message_preview?.toLowerCase().includes(search),
  );
}

export interface ConversationDetail {
  conversation: Conversation;
  customer: Customer;
  messages: Message[];
  lead: Lead | null;
  events: LeadEvent[];
  notes: Array<StaffNote & { author: Pick<Profile, 'id' | 'full_name'> | null }>;
  followUps: FollowUp[];
}

export async function getConversationDetail(
  businessId: string,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const supabase = await createServerSupabase();

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not load conversation: ${error.message}`);
  if (!conversation) return null;

  const conv = conversation as Conversation;

  const [{ data: customer }, { data: messages }, { data: lead }] = await Promise.all([
    supabase.from('customers').select('*').eq('business_id', businessId).eq('id', conv.customer_id).single(),
    supabase
      .from('messages')
      .select('*')
      .eq('business_id', businessId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(300),
    supabase
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .eq('conversation_id', conversationId)
      .maybeSingle(),
  ]);

  const typedLead = (lead as Lead | null) ?? null;

  const [events, notes, followUps] = typedLead
    ? await Promise.all([
        supabase
          .from('lead_events')
          .select('*')
          .eq('business_id', businessId)
          .eq('lead_id', typedLead.id)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('staff_notes')
          .select('*')
          .eq('business_id', businessId)
          .eq('lead_id', typedLead.id)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('follow_ups')
          .select('*')
          .eq('business_id', businessId)
          .eq('lead_id', typedLead.id)
          .order('sequence_index', { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const noteRows = (notes.data ?? []) as StaffNote[];
  const authors = await loadProfiles(noteRows.map((note) => note.author_id));

  return {
    conversation: conv,
    customer: customer as Customer,
    messages: (messages ?? []) as Message[],
    lead: typedLead,
    events: (events.data ?? []) as LeadEvent[],
    notes: noteRows.map((note) => ({
      ...note,
      author: authors.get(note.author_id ?? '') ?? null,
    })),
    followUps: (followUps.data ?? []) as FollowUp[],
  };
}

export interface LeadListItem extends Lead {
  customer: Pick<Customer, 'id' | 'name' | 'phone_number'>;
  assignee: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface LeadFilters {
  status?: string;
  temperature?: string;
  sort?: 'newest' | 'score' | 'value' | 'follow_up';
  search?: string;
  limit?: number;
}

export async function listLeads(
  businessId: string,
  filters: LeadFilters = {},
): Promise<LeadListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from('leads')
    .select('*, customers!inner(id, name, phone_number)')
    .eq('business_id', businessId)
    .limit(filters.limit ?? 200);

  if (filters.status === 'follow_up_due') {
    query = query.not('next_follow_up_at', 'is', null).in('status', ['new', 'active', 'follow_up_due', 'hot', 'warm', 'cold']);
  } else if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters.temperature && filters.temperature !== 'all') {
    query = query.eq('temperature', filters.temperature);
  }

  switch (filters.sort) {
    case 'score':
      query = query.order('lead_score', { ascending: false });
      break;
    case 'value':
      query = query.order('estimated_value', { ascending: false, nullsFirst: false });
      break;
    case 'follow_up':
      query = query.order('next_follow_up_at', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load leads: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<Lead & { customers: LeadListItem['customer'] }>;

  // profiles is joined in a second query: assigned_staff_id references
  // auth.users, which PostgREST cannot embed public.profiles across.
  const assignees = await loadProfiles(rows.map((row) => row.assigned_staff_id));

  const items = rows.map(({ customers, ...lead }) => ({
    ...(lead as Lead),
    customer: customers,
    assignee: assignees.get((lead as Lead).assigned_staff_id ?? '') ?? null,
  }));

  const search = filters.search?.trim().toLowerCase();
  if (!search) return items;
  return items.filter(
    (item) =>
      item.customer.name?.toLowerCase().includes(search) ||
      item.customer.phone_number.includes(search),
  );
}

export interface FollowUpListItem extends FollowUp {
  lead: Pick<Lead, 'id' | 'status' | 'temperature' | 'lead_score' | 'conversation_id'>;
  customer: Pick<Customer, 'id' | 'name' | 'phone_number'>;
  rule: Pick<FollowUpRule, 'id' | 'name'> | null;
}

export async function listFollowUps(
  businessId: string,
  status: string = 'scheduled',
): Promise<FollowUpListItem[]> {
  const supabase = await createServerSupabase();
  let query = supabase
    .from('follow_ups')
    .select(
      '*, leads!inner(id, status, temperature, lead_score, conversation_id, customer_id), follow_up_rules(id, name)',
    )
    .eq('business_id', businessId)
    .order('scheduled_for', { ascending: true })
    .limit(200);

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load follow-ups: ${error.message}`);

  const rows = (data ?? []) as unknown as Array<
    FollowUp & {
      leads: FollowUpListItem['lead'] & { customer_id: string };
      follow_up_rules: FollowUpListItem['rule'];
    }
  >;

  const customerIds = [...new Set(rows.map((row) => row.leads.customer_id))];
  const { data: customers } = customerIds.length
    ? await supabase
        .from('customers')
        .select('id, name, phone_number')
        .eq('business_id', businessId)
        .in('id', customerIds)
    : { data: [] };

  const customerById = new Map(
    ((customers ?? []) as FollowUpListItem['customer'][]).map((c) => [c.id, c]),
  );

  return rows.map(({ leads, follow_up_rules, ...followUp }) => ({
    ...(followUp as FollowUp),
    lead: leads,
    rule: follow_up_rules,
    customer: customerById.get(leads.customer_id) ?? {
      id: leads.customer_id,
      name: null,
      phone_number: '',
    },
  }));
}

export async function listTeamMembers(businessId: string): Promise<
  Array<{ userId: string; role: string; profile: Pick<Profile, 'id' | 'full_name' | 'email'> | null }>
> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('business_members')
    .select('user_id, role')
    .eq('business_id', businessId);
  if (error) throw new Error(`Could not load the team: ${error.message}`);

  const rows = (data ?? []) as Array<{ user_id: string; role: string }>;
  const profiles = await loadProfiles(rows.map((row) => row.user_id));

  return rows.map((row) => ({
    userId: row.user_id,
    role: row.role,
    profile: profiles.get(row.user_id) ?? null,
  }));
}

export async function countOpenWork(
  businessId: string,
): Promise<{ conversations: number; followUpsDue: number; openIssues: number }> {
  const supabase = await createServerSupabase();
  const [conversations, followUps, issues] = await Promise.all([
    supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'open')
      .gt('unread_count', 0),
    supabase
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString()),
    supabase
      .from('system_events')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .is('resolved_at', null),
  ]);

  return {
    conversations: conversations.count ?? 0,
    followUpsDue: followUps.count ?? 0,
    openIssues: issues.count ?? 0,
  };
}
