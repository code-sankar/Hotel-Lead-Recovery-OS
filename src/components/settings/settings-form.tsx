'use client';

import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { emptyFormState, type FormState } from '@/lib/forms/state';

type BoundAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Wraps a settings form so every section gets the same save/pending/error
 * behaviour. `children` receives the current field errors.
 */
export function SettingsForm({
  action,
  submitLabel = 'Save changes',
  children,
  footer,
}: {
  action: BoundAction;
  submitLabel?: string;
  children: (fieldErrors: Record<string, string>) => ReactNode;
  footer?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {children(state.fieldErrors ?? {})}

      {state.error ? (
        <p role="alert" className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 border-t border-ink-200 pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {state.ok && state.message ? (
          <span role="status" className="text-[13px] text-money-700">
            {state.message}
          </span>
        ) : null}
        {footer}
      </div>
    </form>
  );
}
