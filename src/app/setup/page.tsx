import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { hasServiceRoleKey, supabaseConfigStatus } from '@/lib/env';
import { probeSchema } from '@/lib/setup/schema-check';

export const metadata: Metadata = { title: 'Finish setup' };
export const dynamic = 'force-dynamic';

/**
 * Setup diagnostics.
 *
 * Reached whenever Supabase credentials are missing, and useful at any time.
 * It deliberately imports nothing that throws on a missing environment, so it
 * can still render when the rest of the app cannot.
 */

type CheckState = 'ok' | 'error' | 'warn';

interface Check {
  state: CheckState;
  title: string;
  detail: string;
  fix?: React.ReactNode;
}

function schemaIncomplete(missing: string, migration: string, adds: string): Check {
  return {
    state: 'error',
    title: 'Database schema incomplete',
    detail: `Supabase is reachable, but ${missing} is not there — the migration that adds ${adds} (${migration}) has not been applied.`,
    fix: (
      <>
        Apply the migrations in <Code>supabase/migrations/</Code>, in filename order. With the
        connection string from Supabase → Project Settings → Database:
        <pre className="mt-2 overflow-x-auto rounded bg-ink-100 px-3 py-2 text-[12px] text-ink-700">
          {`export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres'
npm run db:push
npm run db:verify`}
        </pre>
        <span className="mt-2 block">
          <Code>db:push</Code> applies whatever is missing and records what it applied, so re-running
          it is safe. <Code>db:verify</Code> then checks what this page cannot see with a browser key
          — row level security, the policy matrix, and whether the credential tables are reachable.
        </span>
      </>
    ),
  };
}

/** Confirms the project is reachable and every migration has been applied. */
async function probeDatabase(url: string, anonKey: string): Promise<Check> {
  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const probe = await probeSchema(client);

    switch (probe.status) {
      case 'ready':
        return {
          state: 'ok',
          title: 'Database ready',
          detail: 'Supabase is reachable and every migration is applied.',
        };
      case 'incomplete':
        return schemaIncomplete(probe.missing, probe.migration, probe.adds);
      case 'unreachable':
        return unreachable(url, probe.message);
      case 'rejected':
        return {
          state: 'error',
          title: 'Supabase rejected the request',
          detail: probe.message,
          fix: (
            <>
              Check that <Code>NEXT_PUBLIC_SUPABASE_URL</Code> and{' '}
              <Code>NEXT_PUBLIC_SUPABASE_ANON_KEY</Code> come from the same Supabase project (Project
              Settings → API), and that you copied the <em>anon</em> key rather than the service role
              key.
            </>
          ),
        };
    }
  } catch (error) {
    return unreachable(url, error instanceof Error ? error.message : String(error));
  }
}

function unreachable(url: string, message: string): Check {
  return {
    state: 'error',
    title: 'Cannot reach Supabase',
    detail: `${url} did not respond (${message}).`,
    fix: (
      <>
        Check that <Code>NEXT_PUBLIC_SUPABASE_URL</Code> is the project URL shown in Supabase →
        Project Settings → API (it looks like{' '}
        <Code>https://your-project.supabase.co</Code>), that the project is not paused, and that this
        machine can reach it.
      </>
    ),
  };
}

export default async function SetupPage() {
  const config = supabaseConfigStatus();
  const checks: Check[] = [];

  if (!config.ok) {
    checks.push({
      state: 'error',
      title: 'Supabase credentials missing',
      detail: `Not set: ${config.missing.join(', ')}`,
      fix: (
        <>
          Copy <Code>.env.example</Code> to <Code>.env.local</Code>, fill in the project URL and anon
          key from Supabase → Project Settings → API, then restart <Code>npm run dev</Code>.
        </>
      ),
    });
  } else {
    checks.push({
      state: 'ok',
      title: 'Supabase credentials found',
      detail: 'The project URL and anon key are set.',
    });
    checks.push(
      await probeDatabase(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      ),
    );
  }

  checks.push(
    hasServiceRoleKey()
      ? {
          state: 'ok',
          title: 'Service role key found',
          detail: 'The webhook, the worker and demo mode can run.',
        }
      : {
          state: 'warn',
          title: 'Service role key not set',
          detail:
            'You can sign in and configure your hotel, but demo mode, the WhatsApp webhook and the follow-up worker need it.',
          fix: (
            <>
              Add <Code>SUPABASE_SERVICE_ROLE_KEY</Code> to <Code>.env.local</Code>. It bypasses row
              level security, so keep it server-side and never expose it to the browser.
            </>
          ),
      },
  );

  checks.push(
    process.env.OPENAI_API_KEY
      ? {
          state: 'ok',
          title: 'OpenAI configured',
          detail: 'Replies are generated with the OpenAI Responses API.',
        }
      : {
          state: 'warn',
          title: 'No OpenAI key',
          detail:
            'Optional. Without it, replies come from the built-in rule-based engine using your hotel data, stamped rules-v1 so they are never mistaken for model output.',
        },
  );

  const blocked = checks.some((check) => check.state === 'error');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        {blocked ? 'Finish setting up Lead Stay' : 'Setup looks good'}
      </h1>
      <p className="mt-1 text-[13px] text-ink-500">
        {blocked
          ? 'The app cannot start until the items below are fixed.'
          : 'Everything the app needs is configured.'}
      </p>

      <ol className="mt-6 flex flex-col gap-3">
        {checks.map((check) => (
          <li
            key={check.title}
            className="rounded-card border border-ink-200 bg-white px-4 py-3.5"
          >
            <div className="flex items-start gap-2.5">
              <StateDot state={check.state} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">{check.title}</p>
                <p className="mt-0.5 text-[13px] text-ink-600">{check.detail}</p>
                {check.fix ? (
                  <div className="mt-2 rounded-md bg-ink-50 px-3 py-2 text-[13px] leading-relaxed text-ink-600">
                    {check.fix}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 text-[13px] text-ink-500">
        Full instructions are in <Code>README.md</Code>. Once the errors above are cleared, restart
        the dev server and open{' '}
        <Link href="/" className="font-medium text-accent-600 hover:text-accent-700">
          the app
        </Link>
        .
      </p>
    </main>
  );
}

function StateDot({ state }: { state: CheckState }) {
  const styles: Record<CheckState, string> = {
    ok: 'bg-money-600',
    warn: 'bg-warm-600',
    error: 'bg-hot-600',
  };
  const labels: Record<CheckState, string> = { ok: 'Ready', warn: 'Optional', error: 'Action needed' };
  return (
    <span
      aria-label={labels[state]}
      role="img"
      className={`mt-1.5 size-2 shrink-0 rounded-full ${styles[state]}`}
    />
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[12px] text-ink-800">
      {children}
    </code>
  );
}
