import type { Metadata } from 'next';
import { requireCapability } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/db/server-client';
import type { WhatsAppIntegrationStatus } from '@/types/domain';
import { publicEnv } from '@/lib/env';
import { SettingsSection } from '@/components/settings/settings-section';
import { SettingsForm } from '@/components/settings/settings-form';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { updateWhatsAppSettingsAction } from '@/lib/settings/actions';
import { formatDateTime } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'WhatsApp' };

export default async function WhatsAppSettingsPage() {
  const { active } = await requireCapability('whatsapp:manage');
  const supabase = await createServerSupabase();

  // Reads the non-secret view: tokens are never sent to the browser.
  const { data } = await supabase
    .from('whatsapp_integration_status')
    .select('*')
    .eq('business_id', active.business.id)
    .maybeSingle();
  const status = (data as WhatsAppIntegrationStatus | null) ?? null;

  const webhookUrl = `${publicEnv().NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
  const isLive = active.business.messaging_mode === 'live';

  return (
    <>
      <SettingsSection title="Connection" description="How this hotel sends and receives WhatsApp messages.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-200 px-4 py-3">
            {isLive ? (
              <Badge tone="money">Live — sending through Meta</Badge>
            ) : (
              <Badge tone="warm">Demo — messages are simulated</Badge>
            )}
            <span className="text-[13px] text-ink-600">
              {status?.display_phone_number ?? 'No WhatsApp number connected yet.'}
            </span>
            {status?.last_verified_at ? (
              <span className="text-[13px] text-ink-500">
                Last verified {formatDateTime(status.last_verified_at, active.business.timezone)}
              </span>
            ) : null}
          </div>

          {status?.last_error ? (
            <p className="rounded-md bg-hot-50 px-3 py-2 text-[13px] text-hot-700">
              Last error from Meta: {status.last_error}
            </p>
          ) : null}

          <div className="rounded-md bg-ink-50 px-4 py-3">
            <p className="text-[13px] font-medium text-ink-700">Webhook URL</p>
            <code className="mt-1 block break-all text-[12px] text-ink-600">{webhookUrl}</code>
            <p className="mt-2 text-[13px] text-ink-500">
              Set this as the callback URL in Meta → WhatsApp → Configuration, using the verify token
              below, and subscribe to the <code className="text-[12px]">messages</code> field.
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Credentials"
        description="Stored server-side and never shown again once saved. Leave a field blank to keep the stored value."
      >
        <SettingsForm action={updateWhatsAppSettingsAction.bind(null, active.business.id)}>
          {(errors) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Phone number ID"
                  htmlFor="phoneNumberId"
                  hint={status?.has_phone_number_id ? 'Stored ✓' : 'From Meta → WhatsApp → API Setup.'}
                  error={errors.phoneNumberId}
                >
                  <Input id="phoneNumberId" name="phoneNumberId" placeholder="123456789012345" />
                </Field>
                <Field label="Display phone number" htmlFor="displayPhoneNumber" error={errors.displayPhoneNumber}>
                  <Input
                    id="displayPhoneNumber"
                    name="displayPhoneNumber"
                    defaultValue={status?.display_phone_number ?? ''}
                    placeholder="+91 373 230 0100"
                  />
                </Field>
              </div>

              <Field
                label="WhatsApp Business Account ID"
                htmlFor="wabaId"
                hint={status?.has_waba_id ? 'Stored ✓' : undefined}
                error={errors.wabaId}
              >
                <Input id="wabaId" name="wabaId" placeholder="WABA id" />
              </Field>

              <Field
                label="Access token"
                htmlFor="accessToken"
                hint={status?.has_access_token ? 'A token is stored. Enter a new one to replace it.' : 'Permanent system-user token.'}
                error={errors.accessToken}
              >
                <Input id="accessToken" name="accessToken" type="password" autoComplete="off" placeholder="••••••••" />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="App secret"
                  htmlFor="appSecret"
                  hint={status?.has_app_secret ? 'Stored ✓ — used to verify webhook signatures.' : 'Used to verify webhook signatures.'}
                  error={errors.appSecret}
                >
                  <Input id="appSecret" name="appSecret" type="password" autoComplete="off" placeholder="••••••••" />
                </Field>
                <Field
                  label="Verify token"
                  htmlFor="verifyToken"
                  hint={status?.has_verify_token ? 'Stored ✓ — enter the same value in Meta.' : 'Any string; must match Meta.'}
                  error={errors.verifyToken}
                >
                  <Input id="verifyToken" name="verifyToken" type="password" autoComplete="off" placeholder="••••••••" />
                </Field>
              </div>

              <Field
                label="Messaging mode"
                htmlFor="messagingMode"
                hint="Demo simulates every send locally. Live sends through the Meta Cloud API."
                error={errors.messagingMode}
              >
                <Select id="messagingMode" name="messagingMode" defaultValue={active.business.messaging_mode}>
                  <option value="demo">Demo — simulate messages</option>
                  <option value="live">Live — send through WhatsApp</option>
                </Select>
              </Field>
            </>
          )}
        </SettingsForm>
      </SettingsSection>

      <SettingsSection title="Before you go live" description="What Meta requires from your side.">
        <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] text-ink-600">
          <li>Create a Meta app with the WhatsApp product and add your business phone number.</li>
          <li>Generate a permanent system-user access token with <code className="text-[12px]">whatsapp_business_messaging</code>.</li>
          <li>Set the webhook URL and verify token above, then subscribe to <code className="text-[12px]">messages</code>.</li>
          <li>
            Create and get approval for the follow-up templates named on the Follow-ups page. Without
            them, follow-ups sent more than 24 hours after a guest’s last message cannot be delivered.
          </li>
          <li>Switch messaging mode to Live.</li>
        </ol>
      </SettingsSection>
    </>
  );
}
