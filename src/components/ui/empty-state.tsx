import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
