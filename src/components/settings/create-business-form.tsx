'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { emptyFormState } from '@/lib/forms/state';
import { createBusinessAction } from '@/lib/settings/actions';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Singapore',
  'UTC',
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'LKR', 'NPR'];

export function CreateBusinessForm() {
  const [state, formAction, pending] = useActionState(createBusinessAction, emptyFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Hotel name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" placeholder="Riverfront Residency" required autoFocus />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Timezone" htmlFor="timezone" hint="Used for follow-up timing and reports.">
          <Select id="timezone" name="timezone" defaultValue="Asia/Kolkata">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="INR">
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creating…' : 'Create hotel'}
      </Button>
    </form>
  );
}
