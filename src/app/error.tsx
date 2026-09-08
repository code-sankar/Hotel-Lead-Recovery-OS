'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Route-level error boundary. Turns an unhandled server error into something a
 * hotel owner can act on, instead of a blank "Internal Server Error".
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] unhandled error', error);
  }, [error]);

  const looksLikeSchema = /does not exist|relation .* does not exist|42P01/i.test(error.message);
  const looksLikeAuth = /JWT|Invalid API key|apikey/i.test(error.message);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-lg font-semibold tracking-tight text-ink-900">Something went wrong</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        {looksLikeSchema
          ? 'The database is reachable but the schema does not look applied yet.'
          : looksLikeAuth
            ? 'Supabase rejected the credentials this app is using.'
            : 'The page could not be loaded.'}
      </p>

      <pre className="mt-4 overflow-x-auto rounded-md bg-ink-100 px-3 py-2.5 font-mono text-[12px] text-ink-700">
        {error.message}
      </pre>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700"
        >
          Try again
        </button>
        <Link
          href="/setup"
          className="inline-flex h-9 items-center rounded-md border border-ink-200 bg-white px-4 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-50"
        >
          Run setup checks
        </Link>
      </div>
    </main>
  );
}
