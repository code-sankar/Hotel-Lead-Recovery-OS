import 'server-only';

import type { Lead, LeadEvent, Message } from '@/types/domain';
import { createServerSupabase } from '@/lib/db/server-client';

/**
 * Reporting.
 *
 * The important honesty rule lives here: "recovered revenue" counts only
 * conversions where the event log shows an automated follow-up was actually
 * sent to that guest BEFORE they converted. Everything else is reported as
 * total booked revenue, never as revenue the system recovered.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeForDays(days: number, now: Date = new Date()): DateRange {
  const to = new Date(now);
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** Start of the hotel's local day, expressed as a UTC instant. */
export function todayRange(timezone: string, now: Date = new Date()): DateRange {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const year = value('year');
  const month = value('month');
  const day = value('day');

  // The zone's offset at this instant, derived by comparing local wall-clock
  // time with the actual instant.
  const localAsUtc = Date.UTC(year, month - 1, day, value('hour'), value('minute'), value('second'));
  const offset = localAsUtc - now.getTime();

  return { from: new Date(Date.UTC(year, month - 1, day) - offset), to: now };
}

export interface DashboardMetrics {
  enquiries: number;
  hotLeads: number;
  followUpsDue: number;
  conversions: number;
  conversionRate: number;
  pipelineValue: number;
  bookedRevenue: number;
  recoveredRevenue: number;
  recoveredConversions: number;
  funnel: { label: string; value: number }[];
}

export interface ConvertedLeadRow {
  id: string;
  conversion_value: number | null;
  converted_at: string | null;
}

/**
 * The attribution rule, as a pure function.
 *
 * A conversion counts as "recovered" only when an automated follow-up was
 * actually SENT to that guest at or before the moment they converted. A
 * follow-up that was merely scheduled, or one sent after the booking, does not
 * count — the system must not claim credit the event log cannot evidence.
 */
export function partitionByFollowUp(
  leads: ConvertedLeadRow[],
  followUpSentAtByLead: Map<string, string[]>,
): { recovered: ConvertedLeadRow[]; direct: ConvertedLeadRow[] } {
  const recovered: ConvertedLeadRow[] = [];
  const direct: ConvertedLeadRow[] = [];

  for (const lead of leads) {
    const sentTimes = followUpSentAtByLead.get(lead.id) ?? [];
    const convertedAt = lead.converted_at ? new Date(lead.converted_at).getTime() : null;
    const wasRecovered =
      convertedAt !== null &&
      sentTimes.some((time) => {
        const sentAt = new Date(time).getTime();
        return Number.isFinite(sentAt) && sentAt <= convertedAt;
      });
    (wasRecovered ? recovered : direct).push(lead);
  }

  return { recovered, direct };
}

/** Loads `follow_up_sent` events for these leads and applies the attribution rule. */
export async function attributeConversions(
  businessId: string,
  leads: ConvertedLeadRow[],
): Promise<{ recovered: ConvertedLeadRow[]; direct: ConvertedLeadRow[] }> {
  if (leads.length === 0) return { recovered: [], direct: [] };

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('lead_events')
    .select('lead_id, created_at')
    .eq('business_id', businessId)
    .eq('type', 'follow_up_sent')
    .in(
      'lead_id',
      leads.map((lead) => lead.id),
    );

  const followUpsByLead = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{ lead_id: string; created_at: string }>) {
    const list = followUpsByLead.get(row.lead_id) ?? [];
    list.push(row.created_at);
    followUpsByLead.set(row.lead_id, list);
  }

  return partitionByFollowUp(leads, followUpsByLead);
}

function sumValues(leads: ConvertedLeadRow[]): number {
  return leads.reduce((total, lead) => total + Number(lead.conversion_value ?? 0), 0);
}

export async function getDashboardMetrics(
  businessId: string,
  range: DateRange,
): Promise<DashboardMetrics> {
  const supabase = await createServerSupabase();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [enquiryRows, openRows, convertedRows, dueCount] = await Promise.all([
    supabase
      .from('leads')
      .select('id, lead_score, temperature, follow_ups_sent, status')
      .eq('business_id', businessId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('leads')
      .select('id, temperature, estimated_value, status')
      .eq('business_id', businessId)
      .in('status', ['new', 'active', 'follow_up_due', 'hot', 'warm', 'cold']),
    supabase
      .from('leads')
      .select('id, conversion_value, converted_at')
      .eq('business_id', businessId)
      .eq('status', 'converted')
      .gte('converted_at', fromIso)
      .lte('converted_at', toIso),
    supabase
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString()),
  ]);

  const enquiries = (enquiryRows.data ?? []) as Array<
    Pick<Lead, 'id' | 'lead_score' | 'temperature' | 'follow_ups_sent' | 'status'>
  >;
  const open = (openRows.data ?? []) as Array<Pick<Lead, 'id' | 'temperature' | 'estimated_value'>>;
  const converted = (convertedRows.data ?? []) as ConvertedLeadRow[];

  const { recovered } = await attributeConversions(businessId, converted);

  const qualified = enquiries.filter((lead) => lead.lead_score >= 20).length;
  const hotInRange = enquiries.filter((lead) => lead.temperature === 'hot').length;
  const followedUp = enquiries.filter((lead) => lead.follow_ups_sent > 0).length;

  return {
    enquiries: enquiries.length,
    hotLeads: open.filter((lead) => lead.temperature === 'hot').length,
    followUpsDue: dueCount.count ?? 0,
    conversions: converted.length,
    conversionRate: enquiries.length > 0 ? (converted.length / enquiries.length) * 100 : 0,
    pipelineValue: open.reduce((total, lead) => total + Number(lead.estimated_value ?? 0), 0),
    bookedRevenue: sumValues(converted),
    recoveredRevenue: sumValues(recovered),
    recoveredConversions: recovered.length,
    funnel: [
      { label: 'Enquiries', value: enquiries.length },
      { label: 'Qualified', value: qualified },
      { label: 'Hot', value: hotInRange },
      { label: 'Followed up', value: followedUp },
      { label: 'Converted', value: converted.length },
    ],
  };
}

export interface ActivityItem {
  id: string;
  type: string;
  leadId: string;
  conversationId: string | null;
  customerName: string;
  at: string;
  data: Record<string, unknown>;
}

export async function getRecentActivity(
  businessId: string,
  limit = 12,
): Promise<ActivityItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('lead_events')
    .select('*, leads!inner(id, conversation_id, customer_id)')
    .eq('business_id', businessId)
    .in('type', [
      'lead_created',
      'follow_up_sent',
      'human_takeover',
      'lead_converted',
      'lead_lost',
      'customer_opted_out',
    ])
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as Array<
    LeadEvent & { leads: { id: string; conversation_id: string; customer_id: string } }
  >;
  if (rows.length === 0) return [];

  const customerIds = [...new Set(rows.map((row) => row.leads.customer_id))];
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone_number')
    .eq('business_id', businessId)
    .in('id', customerIds);

  const nameById = new Map(
    ((customers ?? []) as Array<{ id: string; name: string | null; phone_number: string }>).map(
      (customer) => [customer.id, customer.name ?? customer.phone_number],
    ),
  );

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    leadId: row.lead_id,
    conversationId: row.leads.conversation_id,
    customerName: nameById.get(row.leads.customer_id) ?? 'A guest',
    at: row.created_at,
    data: row.data,
  }));
}

export interface AnalyticsSummary {
  conversations: number;
  inboundMessages: number;
  outboundMessages: number;
  newLeads: number;
  hotLeads: number;
  warmLeads: number;
  followUpsSent: number;
  followUpsReplied: number;
  followUpReplyRate: number;
  conversions: number;
  conversionRate: number;
  bookedRevenue: number;
  attributedRevenue: number;
  averageResponseMinutes: number | null;
  aiHandledConversations: number;
  humanTakeoverRate: number;
  daily: Array<{ date: string; enquiries: number; conversions: number; followUps: number }>;
}

export async function getAnalyticsSummary(
  businessId: string,
  range: DateRange,
): Promise<AnalyticsSummary> {
  const supabase = await createServerSupabase();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [leadRows, messageRows, eventRows, conversationRows] = await Promise.all([
    supabase
      .from('leads')
      .select('id, status, temperature, created_at, converted_at, conversion_value, follow_ups_sent')
      .eq('business_id', businessId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('messages')
      .select('id, conversation_id, direction, sender_type, created_at')
      .eq('business_id', businessId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .limit(5000),
    supabase
      .from('lead_events')
      .select('id, lead_id, type, created_at')
      .eq('business_id', businessId)
      .in('type', ['follow_up_sent', 'customer_replied', 'human_takeover'])
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('conversations')
      .select('id, mode, created_at')
      .eq('business_id', businessId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
  ]);

  const leads = (leadRows.data ?? []) as Array<
    Pick<Lead, 'id' | 'status' | 'temperature' | 'created_at' | 'converted_at' | 'conversion_value' | 'follow_ups_sent'>
  >;
  const messages = (messageRows.data ?? []) as Array<
    Pick<Message, 'id' | 'conversation_id' | 'direction' | 'sender_type' | 'created_at'>
  >;
  const events = (eventRows.data ?? []) as Array<Pick<LeadEvent, 'id' | 'lead_id' | 'type' | 'created_at'>>;
  const conversations = (conversationRows.data ?? []) as Array<{ id: string; mode: string; created_at: string }>;

  const converted = leads
    .filter((lead) => lead.status === 'converted')
    .map((lead) => ({
      id: lead.id,
      conversion_value: lead.conversion_value,
      converted_at: lead.converted_at,
    }));
  const { recovered } = await attributeConversions(businessId, converted);

  // A follow-up counts as "replied" when the guest wrote back after it went out.
  const followUpsByLead = new Map<string, string[]>();
  const repliesByLead = new Map<string, string[]>();
  for (const event of events) {
    const target = event.type === 'follow_up_sent' ? followUpsByLead : event.type === 'customer_replied' ? repliesByLead : null;
    if (!target) continue;
    const list = target.get(event.lead_id) ?? [];
    list.push(event.created_at);
    target.set(event.lead_id, list);
  }

  let followUpsSent = 0;
  let followUpsReplied = 0;
  for (const [leadId, sentTimes] of followUpsByLead) {
    followUpsSent += sentTimes.length;
    const replies = repliesByLead.get(leadId) ?? [];
    for (const sentAt of sentTimes) {
      if (replies.some((reply) => new Date(reply) > new Date(sentAt))) followUpsReplied += 1;
    }
  }

  return {
    conversations: conversations.length,
    inboundMessages: messages.filter((m) => m.direction === 'inbound').length,
    outboundMessages: messages.filter((m) => m.direction === 'outbound').length,
    newLeads: leads.length,
    hotLeads: leads.filter((lead) => lead.temperature === 'hot').length,
    warmLeads: leads.filter((lead) => lead.temperature === 'warm').length,
    followUpsSent,
    followUpsReplied,
    followUpReplyRate: followUpsSent > 0 ? (followUpsReplied / followUpsSent) * 100 : 0,
    conversions: converted.length,
    conversionRate: leads.length > 0 ? (converted.length / leads.length) * 100 : 0,
    bookedRevenue: sumValues(converted),
    attributedRevenue: sumValues(recovered),
    averageResponseMinutes: averageResponseMinutes(messages),
    aiHandledConversations: conversations.filter((c) => c.mode === 'ai').length,
    humanTakeoverRate:
      conversations.length > 0
        ? (conversations.filter((c) => c.mode !== 'ai').length / conversations.length) * 100
        : 0,
    daily: dailySeries(leads, events, range),
  };
}

/** Mean minutes between a guest's message and the first reply that followed it. */
function averageResponseMinutes(
  messages: Array<Pick<Message, 'conversation_id' | 'direction' | 'created_at'>>,
): number | null {
  const byConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }

  const gaps: number[] = [];
  for (const thread of byConversation.values()) {
    let awaitingSince: number | null = null;
    for (const message of thread) {
      const at = new Date(message.created_at).getTime();
      if (message.direction === 'inbound') {
        awaitingSince ??= at;
      } else if (awaitingSince !== null) {
        gaps.push((at - awaitingSince) / 60_000);
        awaitingSince = null;
      }
    }
  }

  if (gaps.length === 0) return null;
  return gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
}

function dailySeries(
  leads: Array<{ created_at: string; converted_at: string | null; status: string }>,
  events: Array<{ type: string; created_at: string }>,
  range: DateRange,
): Array<{ date: string; enquiries: number; conversions: number; followUps: number }> {
  const days: Array<{ date: string; enquiries: number; conversions: number; followUps: number }> = [];
  const cursor = new Date(
    Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()),
  );
  const end = new Date(Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate()));

  const bucket = new Map<string, { enquiries: number; conversions: number; followUps: number }>();
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    bucket.set(key, { enquiries: 0, conversions: 0, followUps: 0 });
    days.push({ date: key, enquiries: 0, conversions: 0, followUps: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const lead of leads) {
    const key = lead.created_at.slice(0, 10);
    const entry = bucket.get(key);
    if (entry) entry.enquiries += 1;
    if (lead.status === 'converted' && lead.converted_at) {
      const convertedEntry = bucket.get(lead.converted_at.slice(0, 10));
      if (convertedEntry) convertedEntry.conversions += 1;
    }
  }
  for (const event of events) {
    if (event.type !== 'follow_up_sent') continue;
    const entry = bucket.get(event.created_at.slice(0, 10));
    if (entry) entry.followUps += 1;
  }

  return days.map((day) => ({ date: day.date, ...(bucket.get(day.date) ?? day) }));
}
