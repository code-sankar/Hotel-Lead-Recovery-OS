import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { BusinessSettings, FollowUpRule } from '@/types/domain';
import { SettingsSection } from '@/components/settings/settings-section';
import { SettingsForm } from '@/components/settings/settings-form';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  updateFollowUpRuleAction,
  updateFollowUpSettingsAction,
} from '@/lib/settings/actions';

export const metadata: Metadata = { title: 'Follow-ups' };

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default async function FollowUpSettingsPage() {
  const { active } = await requireCapability('follow_up_rules:manage');
  const supabase = await createServerSupabase();

  const [{ data: settingsRow }, { data: ruleRows }] = await Promise.all([
    supabase.from('business_settings').select('*').eq('business_id', active.business.id).single(),
    supabase
      .from('follow_up_rules')
      .select('*')
      .eq('business_id', active.business.id)
      .order('sequence_index'),
  ]);

  const settings = settingsRow as BusinessSettings;
  const rules = (ruleRows ?? []) as FollowUpRule[];

  return (
    <>
      <SettingsSection
        title="Automatic follow-ups"
        description="What happens when a guest stops replying. This is the part that recovers revenue."
      >
        <SettingsForm action={updateFollowUpSettingsAction.bind(null, active.business.id)}>
          {(errors) => (
            <>
              <label className="flex items-start gap-3 rounded-md border border-ink-200 px-4 py-3">
                <input
                  type="checkbox"
                  name="followUpsEnabled"
                  defaultChecked={settings.follow_ups_enabled}
                  className="mt-0.5 size-4 rounded border-ink-300 accent-accent-600"
                />
                <span>
                  <span className="block text-[13px] font-medium text-ink-800">
                    Follow up with guests who go quiet
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-500">
                    Stops immediately when the guest replies, when a lead is converted or lost, when
                    your team takes over, or when the guest opts out.
                  </span>
                </span>
              </label>

              <Field
                label="Maximum follow-ups per enquiry"
                htmlFor="maxFollowUps"
                hint="Two is the recommended maximum. More reads as spam."
                error={errors.maxFollowUps}
              >
                <Input
                  id="maxFollowUps"
                  name="maxFollowUps"
                  type="number"
                  min={0}
                  max={5}
                  defaultValue={settings.max_follow_ups}
                  className="w-24"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Quiet hours start"
                  htmlFor="quietHoursStart"
                  hint={`Local time in ${active.business.timezone}.`}
                >
                  <Select
                    id="quietHoursStart"
                    name="quietHoursStart"
                    defaultValue={settings.quiet_hours_start ?? ''}
                  >
                    <option value="">No quiet hours</option>
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quiet hours end" htmlFor="quietHoursEnd">
                  <Select
                    id="quietHoursEnd"
                    name="quietHoursEnd"
                    defaultValue={settings.quiet_hours_end ?? ''}
                  >
                    <option value="">No quiet hours</option>
                    {HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, '0')}:00
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          )}
        </SettingsForm>
      </SettingsSection>

      {rules.map((rule) => (
        <SettingsSection
          key={rule.id}
          title={`Step ${rule.sequence_index}`}
          description={
            rule.trigger === 'customer_inactive'
              ? 'Measured from the guest’s last message.'
              : 'Measured from the previous follow-up being sent.'
          }
        >
          <SettingsForm action={updateFollowUpRuleAction.bind(null, active.business.id)} submitLabel="Save step">
            {(errors) => (
              <>
                <input type="hidden" name="id" value={rule.id} />
                <Field label="Name" htmlFor={`name-${rule.id}`} error={errors.name}>
                  <Input id={`name-${rule.id}`} name="name" defaultValue={rule.name} required />
                </Field>
                <Field
                  label="Wait before sending (minutes)"
                  htmlFor={`delay-${rule.id}`}
                  hint={`${Math.round(rule.delay_minutes / 60)} hours at the current setting.`}
                  error={errors.delayMinutes}
                >
                  <Input
                    id={`delay-${rule.id}`}
                    name="delayMinutes"
                    type="number"
                    min={15}
                    defaultValue={rule.delay_minutes}
                    className="w-32"
                    required
                  />
                </Field>
                <Field
                  label="Message"
                  htmlFor={`template-${rule.id}`}
                  hint="Use {{customer_name}} for the guest’s first name."
                  error={errors.messageTemplate}
                >
                  <Textarea
                    id={`template-${rule.id}`}
                    name="messageTemplate"
                    rows={3}
                    defaultValue={rule.message_template}
                    required
                  />
                </Field>
                <label className="flex items-center gap-2 text-[13px] text-ink-700">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={rule.active}
                    className="size-4 rounded border-ink-300 accent-accent-600"
                  />
                  Active
                </label>
              </>
            )}
          </SettingsForm>
        </SettingsSection>
      ))}

      <SettingsSection title="WhatsApp templates" description="Required for follow-ups sent in live mode.">
        <p className="text-[13px] leading-relaxed text-ink-600">
          WhatsApp only allows free-form messages within 24 hours of the guest’s last message. A
          follow-up sent after that must use a template approved by Meta. This app stores the
          template name to use for each step (
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">leadstay_follow_up_1</code>,{' '}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[12px]">leadstay_follow_up_2</code>); you
          must create and get those templates approved in your WhatsApp Business account. Until then,
          live follow-ups outside the window will be recorded as failed with the reason — they are
          never silently dropped. In demo mode nothing is sent to Meta at all.
        </p>
      </SettingsSection>
    </>
  );
}
