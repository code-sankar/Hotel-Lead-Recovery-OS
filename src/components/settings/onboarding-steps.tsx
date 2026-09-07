import Link from 'next/link';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const STEPS = [
  { href: '/onboarding/hotel', label: 'Hotel details' },
  { href: '/onboarding/rooms', label: 'Room types' },
  { href: '/onboarding/policies', label: 'Policies' },
  { href: '/onboarding/faqs', label: 'FAQs' },
] as const;

export function OnboardingSteps({ current }: { current: (typeof STEPS)[number]['href'] }) {
  const currentIndex = STEPS.findIndex((step) => step.href === current);

  return (
    <ol className="flex flex-wrap items-center gap-1 text-[13px]">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.href} className="flex items-center gap-1">
            <Link
              href={step.href}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors',
                active ? 'bg-ink-900 text-white' : done ? 'text-money-700 hover:bg-ink-100' : 'text-ink-500 hover:bg-ink-100',
              )}
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-white text-ink-900' : done ? 'bg-money-600 text-white' : 'bg-ink-200 text-ink-600',
                )}
              >
                {done ? <Check className="size-2.5" /> : index + 1}
              </span>
              {step.label}
            </Link>
            {index < STEPS.length - 1 ? <span className="text-ink-300">›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
