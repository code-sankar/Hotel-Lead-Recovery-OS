import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Harness for exercising the PostgREST layer against a real server.
 *
 * Everything else in the suite runs against an in-memory store, which proves
 * the orchestration but says nothing about whether `customers!inner(...)`
 * resolves or whether an RPC's argument names match. This talks to actual
 * PostgREST over HTTP, using the same supabase-js client the app uses.
 */

export const PGRST_URL = process.env.LEADSTAY_PGRST_URL ?? '';
export const JWT_SECRET =
  process.env.LEADSTAY_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

export const isConfigured = Boolean(PGRST_URL);

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Mints the kind of token Supabase issues, so auth.uid() resolves in policies. */
export function mintJwt(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims }),
  );
  const signature = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

export function anonToken(): string {
  return mintJwt({ role: 'anon' });
}

export function userToken(userId: string): string {
  return mintJwt({ role: 'authenticated', sub: userId });
}

export function serviceToken(): string {
  return mintJwt({ role: 'service_role' });
}

/**
 * supabase-js addresses `${url}/rest/v1`; PostgREST serves at its root. This
 * strips the prefix so the real client code can be used unmodified.
 */
export async function startSupabaseShim(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').replace(/^\/rest\/v1/, '') || '/';
    const target = new URL(path, PGRST_URL);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // Hop-by-hop and host headers must not be forwarded.
      if (['host', 'connection', 'content-length'].includes(key)) continue;
      if (typeof value === 'string') headers[key] = value;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : body,
      })
        .then(async (upstream) => {
          const text = await upstream.text();
          const outHeaders: Record<string, string> = {};
          upstream.headers.forEach((value, key) => {
            if (key !== 'content-encoding' && key !== 'transfer-encoding') outHeaders[key] = value;
          });
          res.writeHead(upstream.status, outHeaders);
          res.end(text);
        })
        .catch((error) => {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: String(error) }));
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A client carrying a specific identity, exactly as the app builds one. */
export function clientFor(url: string, token: string): SupabaseClient {
  return createClient(url, token, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
