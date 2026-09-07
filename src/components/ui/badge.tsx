import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import type { LeadStatus, LeadTemperature } from '@/types/domain';
import { LEAD_STATUS_LABELS, LEAD_TEMPERATURE_LABELS } from '@/lib/leads/status';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-ink-200 bg-ink-100 text-ink-700',
        hot: 'border-hot-200 bg-hot-50 text-hot-700',
        warm: 'border-warm-200 bg-warm-50 text-warm-700',
        cool: 'border-cool-200 bg-cool-50 text-cool-700',
        money: 'border-money-200 bg-money-50 text-money-700',
        accent: 'border-accent-200 bg-accent-50 text-accent-700',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const TEMPERATURE_TONE: Record<LeadTemperature, NonNullable<BadgeProps['tone']>> = {
  hot: 'hot',
  warm: 'warm',
  cold: 'cool',
  low: 'neutral',
};

export function TemperatureBadge({ temperature }: { temperature: LeadTemperature }) {
  return <Badge tone={TEMPERATURE_TONE[temperature]}>{LEAD_TEMPERATURE_LABELS[temperature]}</Badge>;
}

const STATUS_TONE: Record<LeadStatus, NonNullable<BadgeProps['tone']>> = {
  new: 'accent',
  active: 'accent',
  follow_up_due: 'warm',
  hot: 'hot',
  warm: 'warm',
  cold: 'cool',
  converted: 'money',
  lost: 'neutral',
  paused: 'neutral',
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}
