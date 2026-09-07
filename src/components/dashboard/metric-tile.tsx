import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function MetricTile({
  label,
  value,
  hint,
  tone = 'neutral',
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'hot' | 'warm' | 'money' | 'accent';
  action?: ReactNode;
}) {
  const valueTone = {
    neutral: 'text-ink-900',
    hot: 'text-hot-700',
    warm: 'text-warm-700',
    money: 'text-money-700',
    accent: 'text-accent-700',
  }[tone];

  return (
    <div className="rounded-card border border-ink-200 bg-white px-4 py-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular', valueTone)}>{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-snug text-ink-500">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
