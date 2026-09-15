import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Does this project's database actually have every migration applied?
 *
 * The setup page answers that with the anon key, which is all it has before
 * anyone signs in. That limits what can be seen — row level security is
 * invisible from here, because an empty result looks identical whether a policy
 * filtered it or the table is genuinely empty. `npm run db:verify` covers what
 * this cannot; this exists so applying only the first migration can never read
 * as "ready".
 *
 * The error codes below were taken from PostgREST 12.2.3, not from memory:
 * a missing table answers 42P01, a missing column 42703, a missing function
 * PGRST202. A table whose privileges have been revoked also answers 42703 —
 * PostgREST cannot see its columns — so every marker here is a table the anon
 * role can read.
 */

export interface SchemaMarker {
  /** The file that adds it. */
  migration: string;
  /** Human-readable, for the page. */
  adds: string;
  table: string;
  column: string;
}

export const SCHEMA_MARKERS: readonly SchemaMarker[] = [
  {
    migration: '20250101000000_init_schema.sql',
    adds: 'the core tables',
    table: 'businesses',
    column: 'id',
  },
  {
    migration: '20250201000000_room_availability.sql',
    adds: 'room availability',
    table: 'bookings',
    column: 'id',
  },
  {
    migration: '20250301000000_staff_invites.sql',
    adds: 'staff invites',
    table: 'business_invites',
    column: 'id',
  },
  {
    migration: '20250301000100_system_events.sql',
    adds: 'the operational event log',
    table: 'system_events',
    column: 'id',
  },
  {
    migration: '20250301000200_alerting.sql',
    adds: 'failure alerting',
    table: 'system_events',
    column: 'last_alerted_at',
  },
];

/**
 * The functions migration adds no table of its own, so it needs a marker of its
 * own: without it, signing up works and creating a hotel does not.
 */
export const FUNCTION_MARKER = {
  migration: '20250101000100_functions.sql',
  adds: 'the membership helpers and provisioning RPCs',
  fn: 'is_business_member',
} as const;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** PostgreSQL and PostgREST codes that mean "that object is not there". */
const ABSENT_CODES = new Set([
  '42P01', // undefined_table
  '42703', // undefined_column
  '42883', // undefined_function
  'PGRST202', // function not in the schema cache
  'PGRST204', // column not in the schema cache
  'PGRST205', // table not in the schema cache
]);

export interface ProbeError {
  code?: string;
  message?: string;
}

export function isAbsent(error: ProbeError): boolean {
  if (error.code && ABSENT_CODES.has(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? '');
}

/**
 * supabase-js reports a transport failure as an error *value* rather than a
 * throw, so an unreachable project has to be recognised by its message.
 */
export function isTransportFailure(message: string): boolean {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|network|getaddrinfo/i.test(message);
}

export type SchemaProbe =
  | { status: 'ready' }
  | { status: 'incomplete'; missing: string; migration: string; adds: string }
  | { status: 'unreachable'; message: string }
  | { status: 'rejected'; message: string };

export async function probeSchema(client: SupabaseClient): Promise<SchemaProbe> {
  for (const marker of SCHEMA_MARKERS) {
    const { error } = await client.from(marker.table).select(marker.column).limit(1);
    if (!error) continue;

    if (isTransportFailure(error.message)) {
      return { status: 'unreachable', message: error.message };
    }
    // Permission denied implies the object exists, so the migration ran.
    if (error.code === '42501') continue;
    if (isAbsent(error)) {
      return {
        status: 'incomplete',
        missing: `${marker.table}.${marker.column}`,
        migration: marker.migration,
        adds: marker.adds,
      };
    }
    return { status: 'rejected', message: error.message };
  }

  const { error } = await client.rpc(FUNCTION_MARKER.fn, { target_business_id: NIL_UUID });
  if (error && error.code !== '42501') {
    if (isTransportFailure(error.message)) {
      return { status: 'unreachable', message: error.message };
    }
    if (isAbsent(error)) {
      return {
        status: 'incomplete',
        missing: `${FUNCTION_MARKER.fn}()`,
        migration: FUNCTION_MARKER.migration,
        adds: FUNCTION_MARKER.adds,
      };
    }
    return { status: 'rejected', message: error.message };
  }

  return { status: 'ready' };
}
