import { randomUUID } from 'node:crypto';
import type { InboundEvent, MessagingProvider, SendResult, TemplateMessage } from './types';

/**
 * Demo transport.
 *
 * Used when a hotel has no WhatsApp connection yet. It runs the full pipeline
 * end to end but does NOT contact Meta, and says so: every result comes back
 * `simulated` with a `demo:` message id, which the UI renders as an explicit
 * "not sent via WhatsApp" badge. Nothing here pretends to be a real delivery.
 */
export class DemoMessagingProvider implements MessagingProvider {
  readonly channel = 'whatsapp';
  readonly mode = 'demo' as const;

  async sendTextMessage(to: string, text: string): Promise<SendResult> {
    return {
      providerMessageId: `demo:${randomUUID()}`,
      status: 'simulated',
      raw: { simulated: true, to, text },
    };
  }

  async sendTemplateMessage(to: string, template: TemplateMessage): Promise<SendResult> {
    return {
      providerMessageId: `demo:${randomUUID()}`,
      status: 'simulated',
      raw: { simulated: true, to, template },
    };
  }

  async markMessageRead(): Promise<void> {
    // No provider to notify in demo mode.
  }

  processWebhook(): InboundEvent[] {
    // Demo inbound messages are injected through the simulation API, not a webhook.
    return [];
  }
}
