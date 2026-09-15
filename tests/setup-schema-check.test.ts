import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FUNCTION_MARKER,
  SCHEMA_MARKERS,
  probeSchema,
  type ProbeError,
} from '@/lib/setup/schema-check';

/**
 * The setup page's migration check.
 *
 * The error codes asserted here are the ones PostgREST 12.2.3 actually returns
 * — observed against a running server, not assumed: a missing table answers
 * 42P01, a missing column 42703, a missing function PGRST202.
 */

interface FakeResponses {
  table?: (table: string, column: string) => ProbeError | null;
  rpc?: (fn: string) => ProbeError | null;
}

function fakeClient(responses: FakeResponses = {}): SupabaseClient {
  return {
    from: (table: string) => ({
      select: (column: string) => ({
        limit: async () => ({ error: responses.table?.(table, column) ?? null }),
      }),
    }),
    rpc: async (fn: string) => ({ error: responses.rpc?.(fn) ?? null }),
  } as unknown as SupabaseClient;
}

const absent = (column: string) => ({
  code: '42703',
  message: `column ${column} does not exist`,
});

describe('probeSchema', () => {
  it('reports ready when every marker resolves', async () => {
    await expect(probeSchema(fakeClient())).resolves.toEqual({ status: 'ready' });
  });

  it('names the migration that adds a missing table', async () => {
    const probe = await probeSchema(
      fakeClient({
        table: (table) =>
          table === 'bookings'
            ? { code: '42P01', message: 'relation "public.bookings" does not exist' }
            : null,
      }),
    );

    expect(probe).toMatchObject({
      status: 'incomplete',
      missing: 'bookings.id',
      migration: '20250201000000_room_availability.sql',
    });
  });

  it('catches a migration that only adds a column', async () => {
    const probe = await probeSchema(
      fakeClient({
        table: (_table, column) =>
          column === 'last_alerted_at' ? absent('system_events.last_alerted_at') : null,
      }),
    );

    expect(probe).toMatchObject({
      status: 'incomplete',
      missing: 'system_events.last_alerted_at',
      migration: '20250301000200_alerting.sql',
    });
  });

  it('catches the functions migration, which adds no table of its own', async () => {
    const probe = await probeSchema(
      fakeClient({
        rpc: () => ({
          code: 'PGRST202',
          message: 'Could not find the function public.is_business_member in the schema cache',
        }),
      }),
    );

    expect(probe).toMatchObject({
      status: 'incomplete',
      missing: 'is_business_member()',
      migration: '20250101000100_functions.sql',
    });
  });

  it('reports the earliest missing migration, not the last', async () => {
    const probe = await probeSchema(
      fakeClient({
        table: (table) => (table === 'businesses' || table === 'system_events' ? absent(table) : null),
      }),
    );

    expect(probe).toMatchObject({ migration: '20250101000000_init_schema.sql' });
  });

  it('treats permission denied as present — a denial implies the object exists', async () => {
    const probe = await probeSchema(
      fakeClient({
        table: () => ({ code: '42501', message: 'permission denied for table businesses' }),
        rpc: () => ({ code: '42501', message: 'permission denied for function' }),
      }),
    );

    expect(probe).toEqual({ status: 'ready' });
  });

  it('distinguishes an unreachable project from a missing schema', async () => {
    const probe = await probeSchema(
      fakeClient({ table: () => ({ message: 'fetch failed' }) }),
    );

    expect(probe).toEqual({ status: 'unreachable', message: 'fetch failed' });
  });

  it('passes an unrecognised error through rather than guessing', async () => {
    const probe = await probeSchema(
      fakeClient({ table: () => ({ code: 'PGRST301', message: 'JWT expired' }) }),
    );

    expect(probe).toEqual({ status: 'rejected', message: 'JWT expired' });
  });
});

describe('marker coverage', () => {
  it('has a marker for every migration except the one it cannot see', () => {
    const dir = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));

    // Row level security is invisible to a PostgREST client: a policy filtering
    // a row and an empty table look the same. supabase/verify.sql checks it.
    const unprobeable = ['20250101000200_rls_policies.sql'];
    const covered = new Set([
      ...SCHEMA_MARKERS.map((marker) => marker.migration),
      FUNCTION_MARKER.migration,
      ...unprobeable,
    ]);

    expect(files.filter((file) => !covered.has(file))).toEqual([]);
  });
});
