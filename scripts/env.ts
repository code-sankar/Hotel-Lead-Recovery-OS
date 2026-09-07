import { config } from 'dotenv';

/**
 * CLI scripts read .env.local first (developer machine), then .env.
 * Next.js does this itself for the app; standalone scripts must opt in.
 */
config({ path: '.env.local' });
config({ path: '.env' });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}
