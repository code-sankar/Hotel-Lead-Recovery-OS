import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { storeForBusiness } from '@/lib/db/user-store';

/**
 * The session-scoped store is a Proxy exposing only the two reads the
 * availability calculator needs. That shape compiles regardless of whether it
 * behaves, so it is exercised directly.
 */

interface Call {
  table: string;
  filters: Array<[string, string, unknown]>;
}

function fakeClient(rows: unknown[], calls: Call[]): SupabaseClient {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          call.filters.push(['eq', column, value]);
          return builder;
        },
        gte: (column: string, value: unknown) => {
          call.filters.push(['gte', column, value]);
          return builder;
        },
        lt: (column: string, value: unknown) => {
          call.filters.push(['lt', column, value]);
          return builder;
        },
        gt: (column: string, value: unknown) => {
          call.filters.push(['gt', column, value]);
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('storeForBusiness', () => {
  it('reads availability overrides scoped to the business and date window', async () => {
    const calls: Call[] = [];
    const store = storeForBusiness(fakeClient([{ id: 'a' }], calls));

    const rows = await store.listRoomAvailability('biz-1', '2026-09-15', '2026-09-17');

    expect(rows).toEqual([{ id: 'a' }]);
    expect(calls[0]?.table).toBe('room_availability');
    expect(calls[0]?.filters).toEqual([
      ['eq', 'business_id', 'biz-1'],
      ['gte', 'date', '2026-09-15'],
      ['lt', 'date', '2026-09-17'],
    ]);
  });

  it('reads only confirmed bookings that overlap the window', async () => {
    const calls: Call[] = [];
    const store = storeForBusiness(fakeClient([], calls));

    await store.listBookings('biz-1', '2026-09-15', '2026-09-17');

    expect(calls[0]?.table).toBe('bookings');
    expect(calls[0]?.filters).toEqual([
      ['eq', 'business_id', 'biz-1'],
      ['eq', 'status', 'confirmed'],
      // Overlap: starts before the window ends and finishes after it starts.
      ['lt', 'check_in', '2026-09-17'],
      ['gt', 'check_out', '2026-09-15'],
    ]);
  });

  it('refuses anything beyond those reads, loudly and immediately', () => {
    const store = storeForBusiness(fakeClient([], []));
    // Throws synchronously rather than returning a rejected promise, so a
    // misuse surfaces at the call site instead of as an unhandled rejection.
    expect(() =>
      store.createBooking({
        businessId: 'biz-1',
        customerId: 'c',
        roomId: 'r',
        checkIn: '2026-09-15',
        checkOut: '2026-09-16',
      }),
    ).toThrow(/not available on the session-scoped store/);
  });
});
