'use client';

import { useActionState, useEffect } from 'react';
import { HOTEL_POLICY_TYPES, type HotelPolicy, type HotelPolicyType } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { emptyFormState } from '@/lib/forms/state';
import { deletePolicyAction, savePolicyAction } from '@/lib/settings/actions';
import { ListEditor } from './list-editor';

const POLICY_LABELS: Record<HotelPolicyType, string> = {
  cancellation: 'Cancellation',
  child: 'Children',
  extra_bed: 'Extra bed',
  check_in: 'Check-in',
  check_out: 'Check-out',
  pet: 'Pets',
  payment: 'Payment',
  smoking: 'Smoking',
  other: 'Other',
};

export function PoliciesEditor({
  businessId,
  policies,
}: {
  businessId: string;
  policies: HotelPolicy[];
}) {
  return (
    <ListEditor
      items={policies}
      addLabel="Add a policy"
      emptyLabel="No policies yet. The assistant will say a team member must confirm policy questions."
      onDelete={async (id) => deletePolicyAction(businessId, id)}
      renderSummary={(policy) => (
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">{POLICY_LABELS[policy.type]}</Badge>
            {policy.title ? (
              <span className="text-sm font-medium text-ink-900">{policy.title}</span>
            ) : null}
            {!policy.active ? <Badge>Inactive</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] text-ink-600">{policy.content}</p>
        </div>
      )}
      renderForm={(policy, onDone) => (
        <PolicyForm businessId={businessId} policy={policy} onDone={onDone} />
      )}
    />
  );
}

function PolicyForm({
  businessId,
  policy,
  onDone,
}: {
  businessId: string;
  policy: HotelPolicy | null;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    savePolicyAction.bind(null, businessId),
    emptyFormState,
  );

  // Close the inline editor once the server action reports success.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {policy ? <input type="hidden" name="id" value={policy.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Policy type" htmlFor="type" error={state.fieldErrors?.type}>
          <Select id="type" name="type" defaultValue={policy?.type ?? 'cancellation'}>
            {HOTEL_POLICY_TYPES.map((type) => (
              <option key={type} value={type}>
                {POLICY_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="title" error={state.fieldErrors?.title}>
          <Input id="title" name="title" defaultValue={policy?.title ?? ''} placeholder="Cancellation policy" />
        </Field>
      </div>

      <Field
        label="Policy text"
        htmlFor="content"
        hint="Written exactly as the assistant may repeat it to a guest."
        error={state.fieldErrors?.content}
      >
        <Textarea id="content" name="content" rows={3} defaultValue={policy?.content ?? ''} required />
      </Field>

      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input
          type="checkbox"
          name="active"
          defaultChecked={policy?.active ?? true}
          className="size-4 rounded border-ink-300 accent-accent-600"
        />
        Active
      </label>

      {state.error ? <p className="text-[13px] text-hot-600">{state.error}</p> : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : policy ? 'Update policy' : 'Add policy'}
        </Button>
      </div>
    </form>
  );
}
