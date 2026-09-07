import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessSettings } from '@/types/domain';
import { hasOpenAI } from '@/lib/env';
import { SettingsSection } from '@/components/settings/settings-section';
import { SettingsForm } from '@/components/settings/settings-form';
import { Field, Select, Textarea } from '@/components/ui/input';
import { updateAiSettingsAction } from '@/lib/settings/actions';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AiSettingsPage() {
  const { active } = await requireCapability('business:manage');
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('business_settings')
    .select('*')
    .eq('business_id', active.business.id)
    .single();
  const settings = data as BusinessSettings;
  const openAiConfigured = hasOpenAI();

  return (
    <>
      <SettingsSection
        title="Assistant"
        description="How the assistant replies on WhatsApp, and when it hands over to your team."
      >
        <SettingsForm action={updateAiSettingsAction.bind(null, active.business.id)}>
          {(errors) => (
            <>
              <label className="flex items-start gap-3 rounded-md border border-ink-200 px-4 py-3">
                <input
                  type="checkbox"
                  name="aiEnabled"
                  defaultChecked={settings.ai_enabled}
                  className="mt-0.5 size-4 rounded border-ink-300 accent-accent-600"
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink-800">
                    Let the assistant reply to enquiries
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-500">
                    When off, enquiries are still captured, scored and shown in your inbox — your team
                    answers them.
                  </span>
                </span>
              </label>

              <Field label="Tone" htmlFor="aiTone" error={errors.aiTone}>
                <Select id="aiTone" name="aiTone" defaultValue={settings.ai_tone}>
                  <option value="friendly_professional">Friendly and professional</option>
                  <option value="warm_casual">Warm and casual</option>
                  <option value="formal">Formal</option>
                </Select>
              </Field>

              <Field
                label="Welcome message"
                htmlFor="aiWelcomeMessage"
                hint="Sent when someone writes for the first time with just a greeting."
                error={errors.aiWelcomeMessage}
              >
                <Textarea
                  id="aiWelcomeMessage"
                  name="aiWelcomeMessage"
                  rows={2}
                  defaultValue={settings.ai_welcome_message ?? ''}
                />
              </Field>

              <Field
                label="Escalation message"
                htmlFor="aiEscalationMessage"
                hint="Sent verbatim whenever the assistant hands a conversation to your team."
                error={errors.aiEscalationMessage}
              >
                <Textarea
                  id="aiEscalationMessage"
                  name="aiEscalationMessage"
                  rows={2}
                  defaultValue={settings.ai_escalation_message}
                  required
                />
              </Field>
            </>
          )}
        </SettingsForm>
      </SettingsSection>

      <SettingsSection title="What the assistant will never do" description="Enforced in code, not only in the prompt.">
        <ul className="flex flex-col gap-2 text-[13px] text-ink-600">
          {[
            'Say a room is available on a date — this system has no live inventory, so availability is always confirmed by your team.',
            'Quote a price that is not one of your configured room rates (multiplying a rate by the number of nights is allowed).',
            'Mention a room type you have not created.',
            'Say a booking has been made, held or confirmed.',
            'Say a payment has been received.',
            'Offer a discount, upgrade or anything complimentary.',
          ].map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-400" />
              {rule}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-md bg-ink-50 px-3 py-2.5 text-[13px] text-ink-600">
          If a generated reply breaks one of these rules it is not sent. Your escalation message goes
          out instead and the conversation moves to your team.
        </p>
      </SettingsSection>

      <SettingsSection title="Language engine" description="Which engine writes the replies.">
        {openAiConfigured ? (
          <p className="text-[13px] text-ink-600">
            <span className="font-medium text-money-700">OpenAI is configured.</span> Replies are
            generated with the OpenAI Responses API using your hotel data, then checked against the
            rules above before sending. If a request fails, the built-in rule-based engine answers
            instead so the guest is never left waiting.
          </p>
        ) : (
          <p className="text-[13px] text-ink-600">
            <span className="font-medium text-warm-700">No OpenAI key is configured.</span> Replies
            are written by the built-in rule-based engine from your rooms, policies and FAQs. They are
            stamped <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">rules-v1</code> in
            the conversation so you always know what produced them. Set{' '}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">OPENAI_API_KEY</code> to
            switch on the language model.
          </p>
        )}
      </SettingsSection>
    </>
  );
}
