import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-lg font-semibold tracking-tight text-ink-900">Page not found</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        That page does not exist, or the record it pointed at belongs to another hotel.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex h-9 w-fit items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
