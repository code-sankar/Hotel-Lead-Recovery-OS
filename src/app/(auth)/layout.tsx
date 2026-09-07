import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(28rem,34rem)]">
      {/* The value proposition, stated plainly. No stock imagery. */}
      <section className="hidden flex-col justify-between bg-ink-950 px-12 py-12 text-ink-100 lg:flex">
        <Link href="/" className="text-sm font-semibold tracking-tight text-white">
          Hotel Lead Recovery OS
        </Link>
        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug text-white">
            Stop losing hotel enquiries because nobody followed up.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-400">
            Every WhatsApp enquiry is captured, answered from your own hotel information, scored,
            and chased automatically if the guest goes quiet — until your team takes over.
          </p>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-ink-800 pt-8">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">Capture</dt>
              <dd className="mt-1 text-[13px] text-ink-300">Every enquiry becomes a lead</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">Recover</dt>
              <dd className="mt-1 text-[13px] text-ink-300">Automatic, capped follow-ups</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-500">Measure</dt>
              <dd className="mt-1 text-[13px] text-ink-300">Revenue you can trace</dd>
            </div>
          </dl>
        </div>
        <p className="text-xs text-ink-600">Built for independent hotels.</p>
      </section>

      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  );
}
