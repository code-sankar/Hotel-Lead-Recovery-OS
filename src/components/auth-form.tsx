'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { emptyFormState, type FormState } from '@/lib/forms/state';

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

interface FieldSpec {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  pendingLabel,
  hiddenFields,
}: {
  action: Action;
  fields: FieldSpec[];
  submitLabel: string;
  pendingLabel: string;
  hiddenFields?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {fields.map((field) => (
        <Field
          key={field.name}
          label={field.label}
          htmlFor={field.name}
          hint={field.hint}
          error={state.fieldErrors?.[field.name]}
        >
          <Input
            id={field.name}
            name={field.name}
            type={field.type ?? 'text'}
            placeholder={field.placeholder}
            autoComplete={field.autoComplete}
            required
          />
        </Field>
      ))}

      {state.error ? (
        <p role="alert" className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="rounded-md bg-money-50 px-3 py-2 text-[13px] text-money-700">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}
