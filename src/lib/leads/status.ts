import type { LeadStatus, LeadTemperature } from '@/types/domain';

/**
 * Lead lifecycle.
 *
 *   new ─────────► active ──► hot | warm | cold ◄──► follow_up_due
 *    │                │             │                     │
 *    └────────────────┴─────────────┴─────────────────────┘
 *                     │
 *                     ├──► paused    (staff paused automation; reversible)
 *                     ├──► converted (terminal)
 *                     └──► lost      (terminal)
 *
 * `new` is the state of an enquiry nobody has answered yet. Once a reply goes
 * out it becomes `active`, and from then on the temperature bands drive the
 * status so the pipeline board reads the way a hotel owner expects. A lead sits
 * in `follow_up_due` from the moment a follow-up is due until the customer
 * replies. converted/lost are terminal in the MVP: reopening means a new
 * enquiry, which keeps revenue attribution honest.
 */

export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  'new',
  'active',
  'follow_up_due',
  'hot',
  'warm',
  'cold',
] as const;

export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = ['converted', 'lost'] as const;

const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['active', 'hot', 'warm', 'cold', 'follow_up_due', 'paused', 'converted', 'lost'],
  active: ['hot', 'warm', 'cold', 'follow_up_due', 'paused', 'converted', 'lost'],
  follow_up_due: ['active', 'hot', 'warm', 'cold', 'paused', 'converted', 'lost'],
  hot: ['active', 'warm', 'cold', 'follow_up_due', 'paused', 'converted', 'lost'],
  warm: ['active', 'hot', 'cold', 'follow_up_due', 'paused', 'converted', 'lost'],
  cold: ['active', 'hot', 'warm', 'follow_up_due', 'paused', 'converted', 'lost'],
  paused: ['active', 'hot', 'warm', 'cold', 'follow_up_due', 'converted', 'lost'],
  converted: [],
  lost: [],
};

export function isOpenLeadStatus(status: LeadStatus): boolean {
  return OPEN_LEAD_STATUSES.includes(status);
}

export function isTerminalLeadStatus(status: LeadStatus): boolean {
  return TERMINAL_LEAD_STATUSES.includes(status);
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The status a live lead should hold given its temperature. Terminal and
 * paused leads are never re-bucketed, and a lead nobody has answered stays
 * `new` until the first outbound message.
 */
export function statusForTemperature(
  current: LeadStatus,
  temperature: LeadTemperature,
  options: { hasBeenAnswered: boolean; followUpDue: boolean },
): LeadStatus {
  if (isTerminalLeadStatus(current) || current === 'paused') return current;
  if (options.followUpDue) return 'follow_up_due';
  if (!options.hasBeenAnswered) return 'new';
  if (temperature === 'low') return 'active';
  return temperature;
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  active: 'Active',
  follow_up_due: 'Follow-up due',
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
  converted: 'Converted',
  lost: 'Lost',
  paused: 'Paused',
};

export const LEAD_TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
  low: 'Low',
};
