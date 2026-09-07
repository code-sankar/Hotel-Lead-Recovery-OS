import type { MemberRole } from '@/types/domain';

/**
 * Role capabilities.
 *
 * Kept as a capability map rather than scattered role checks so a new role is a
 * single edit here. Capabilities gate the UI; the database enforces the same
 * boundaries independently through RLS.
 */
export type Capability =
  | 'business:manage'
  | 'staff:manage'
  | 'whatsapp:manage'
  | 'hotel_content:manage'
  | 'follow_up_rules:manage'
  | 'analytics:view'
  | 'conversations:handle'
  | 'leads:manage'
  | 'customers:manage'
  | 'demo:run';

const ROLE_CAPABILITIES: Record<MemberRole, readonly Capability[]> = {
  owner: [
    'business:manage',
    'staff:manage',
    'whatsapp:manage',
    'hotel_content:manage',
    'follow_up_rules:manage',
    'analytics:view',
    'conversations:handle',
    'leads:manage',
    'customers:manage',
    'demo:run',
  ],
  manager: [
    'follow_up_rules:manage',
    'analytics:view',
    'conversations:handle',
    'leads:manage',
    'customers:manage',
    'demo:run',
  ],
  staff: ['conversations:handle', 'leads:manage', 'customers:manage'],
};

export function can(role: MemberRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesFor(role: MemberRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: 'Full access, including hotel settings, WhatsApp and the team.',
  manager: 'Conversations, leads, follow-up rules and analytics.',
  staff: 'Conversations, leads and customers.',
};
