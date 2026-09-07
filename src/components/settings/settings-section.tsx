import type { ReactNode } from 'react';

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-ink-200 bg-white">
      <div className="border-b border-ink-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}
