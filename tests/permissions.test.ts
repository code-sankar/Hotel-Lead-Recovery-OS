import { describe, expect, it } from 'vitest';
import type { MemberRole } from '@/types/domain';
import { can, capabilitiesFor, type Capability } from '@/lib/auth/permissions';

/**
 * Role boundaries. The database enforces the same lines through RLS; this
 * checks the application's view of them stays in step.
 */

const ROLES: MemberRole[] = ['owner', 'manager', 'staff'];

describe('role capabilities', () => {
  it('gives owners everything', () => {
    const ownerCapabilities = capabilitiesFor('owner');
    for (const role of ROLES) {
      for (const capability of capabilitiesFor(role)) {
        expect(ownerCapabilities).toContain(capability);
      }
    }
  });

  it('keeps hotel configuration to owners', () => {
    for (const capability of [
      'business:manage',
      'staff:manage',
      'whatsapp:manage',
      'hotel_content:manage',
    ] as Capability[]) {
      expect(can('owner', capability)).toBe(true);
      expect(can('manager', capability)).toBe(false);
      expect(can('staff', capability)).toBe(false);
    }
  });

  it('lets managers run automation and read analytics, but not reconfigure the hotel', () => {
    expect(can('manager', 'follow_up_rules:manage')).toBe(true);
    expect(can('manager', 'analytics:view')).toBe(true);
    expect(can('manager', 'conversations:handle')).toBe(true);
    expect(can('manager', 'hotel_content:manage')).toBe(false);
  });

  it('limits staff to day-to-day work', () => {
    expect(can('staff', 'conversations:handle')).toBe(true);
    expect(can('staff', 'leads:manage')).toBe(true);
    expect(can('staff', 'customers:manage')).toBe(true);
    expect(can('staff', 'analytics:view')).toBe(false);
    expect(can('staff', 'follow_up_rules:manage')).toBe(false);
    expect(can('staff', 'demo:run')).toBe(false);
  });

  it('lets every role work a conversation', () => {
    for (const role of ROLES) {
      expect(can(role, 'conversations:handle')).toBe(true);
    }
  });
});
