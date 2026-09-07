import 'server-only';

import { serverEnv } from '@/lib/env';
import type { Store } from '@/lib/db/store';
import { DemoMessagingProvider } from './demo-provider';
import { WhatsAppCloudProvider } from './whatsapp-cloud';
import type { MessagingProvider } from './types';

export interface ResolvedProvider {
  provider: MessagingProvider;
  /** Why this transport was chosen — surfaced in settings and demo tooling. */
  reason: string;
}

/**
 * Picks the transport for a hotel.
 *
 * A hotel only sends through Meta when it is explicitly in live mode AND has
 * usable credentials. Anything short of that falls back to the demo transport,
 * which is labelled as such rather than silently dropping messages.
 */
export async function resolveMessagingProvider(
  store: Store,
  businessId: string,
): Promise<ResolvedProvider> {
  const business = await store.getBusiness(businessId);
  if (!business) {
    return { provider: new DemoMessagingProvider(), reason: 'Unknown business.' };
  }

  if (business.messaging_mode !== 'live') {
    return {
      provider: new DemoMessagingProvider(),
      reason: 'Hotel is in demo mode; messages are simulated and never sent to Meta.',
    };
  }

  const env = serverEnv();
  const integration = await store.getWhatsAppIntegration(businessId);
  const accessToken = integration?.access_token ?? env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = integration?.phone_number_id ?? env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    return {
      provider: new DemoMessagingProvider(),
      reason: 'Live mode is on but WhatsApp credentials are missing; falling back to simulation.',
    };
  }

  return {
    provider: new WhatsAppCloudProvider({
      accessToken,
      phoneNumberId,
      apiVersion: env.WHATSAPP_API_VERSION,
    }),
    reason: 'Sending through the Meta WhatsApp Cloud API.',
  };
}
