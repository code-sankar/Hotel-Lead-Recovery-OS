/**
 * `server-only` throws when imported outside a React Server Component graph.
 * Vitest runs plain Node, so it is aliased to this no-op module (see
 * vitest.config.ts). The marker still does its real job in the Next.js build.
 */
export {};
