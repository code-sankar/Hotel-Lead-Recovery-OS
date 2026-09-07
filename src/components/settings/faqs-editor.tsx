'use client';

import { useActionState, useEffect } from 'react';
import type { HotelFaq } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { emptyFormState } from '@/lib/forms/state';
import { deleteFaqAction, saveFaqAction } from '@/lib/settings/actions';
import { ListEditor } from './list-editor';

export function FaqsEditor({ businessId, faqs }: { businessId: string; faqs: HotelFaq[] }) {
  return (
    <ListEditor
      items={faqs}
      addLabel="Add an FAQ"
      emptyLabel="No FAQs yet. Add the questions guests ask most — parking, breakfast, Wi-Fi, early check-in."
      onDelete={async (id) => deleteFaqAction(businessId, id)}
      renderSummary={(faq) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-900">{faq.question}</span>
            {!faq.active ? <Badge>Inactive</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] text-ink-600">{faq.answer}</p>
        </div>
      )}
      renderForm={(faq, onDone) => <FaqForm businessId={businessId} faq={faq} onDone={onDone} />}
    />
  );
}

function FaqForm({
  businessId,
  faq,
  onDone,
}: {
  businessId: string;
  faq: HotelFaq | null;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    saveFaqAction.bind(null, businessId),
    emptyFormState,
  );

  // Close the inline editor once the server action reports success.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {faq ? <input type="hidden" name="id" value={faq.id} /> : null}

      <Field label="Question" htmlFor="question" error={state.fieldErrors?.question}>
        <Input
          id="question"
          name="question"
          defaultValue={faq?.question ?? ''}
          placeholder="Is parking available?"
          required
        />
      </Field>

      <Field label="Answer" htmlFor="answer" error={state.fieldErrors?.answer}>
        <Textarea
          id="answer"
          name="answer"
          rows={3}
          defaultValue={faq?.answer ?? ''}
          placeholder="Yes, we have free on-site parking for guests."
          required
        />
      </Field>

      <label className="flex items-center gap-2 text-[13px] text-ink-700">
        <input
          type="checkbox"
          name="active"
          defaultChecked={faq?.active ?? true}
          className="size-4 rounded border-ink-300 accent-accent-600"
        />
        Active
      </label>

      {state.error ? <p className="text-[13px] text-hot-600">{state.error}</p> : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : faq ? 'Update FAQ' : 'Add FAQ'}
        </Button>
      </div>
    </form>
  );
}
