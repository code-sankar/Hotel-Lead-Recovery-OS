import { z } from 'zod';

/**
 * Environment access.
 *
 * Server secrets are read lazily through `serverEnv()` so that importing this
 * module from a shared file can never drag a secret into a client bundle, and
 * so the app still boots in demo mode when optional integrations are absent.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  REDIS_URL: z.string().min(1).optional(),
  DEMO_MODE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  CRON_SECRET: z.string().min(1).optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

let cachedPublic: PublicEnv | null = null;
let cachedServer: ServerEnv | null = null;

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only for statically written
 * references, so these must be spelled out rather than read dynamically.
 */
export interface ConfigStatus {
  ok: boolean;
  missing: string[];
}

/**
 * Non-throwing check for the variables the app cannot start without.
 *
 * The proxy uses this to send traffic to /setup with an explanation, rather
 * than throwing and leaving the browser with a bare 500.
 */
export function supabaseConfigStatus(): ConfigStatus {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return { ok: missing.length === 0, missing };
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  });
  if (!parsed.success) {
    throw new Error(
      `Missing Supabase environment variables. Copy .env.example to .env.local and fill in the Supabase project URL and anon key.\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  cachedServer = parsed.data;
  return cachedServer;
}

export function requireServiceRoleKey(): string {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is required for webhook, worker and demo-simulation code paths.',
    );
  }
  return key;
}

/** True when an OpenAI key is configured; otherwise the deterministic fallback engine is used. */
export function hasOpenAI(): boolean {
  return Boolean(serverEnv().OPENAI_API_KEY);
}

export function hasRedis(): boolean {
  return Boolean(serverEnv().REDIS_URL);
}
