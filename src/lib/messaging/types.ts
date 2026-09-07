/**
 * Channel-agnostic messaging port.
 *
 * WhatsApp Cloud API is the only implementation that talks to a real provider;
 * the demo provider exists so the product is fully usable before a Meta number
 * is connected, and it never claims a message reached Meta.
 */

export type MessagingProviderMode = 'live' | 'demo';

export interface SendResult {
  /** Provider-assigned id, or a locally generated id in demo mode. */
  providerMessageId: string | null;
  status: 'sent' | 'failed' | 'simulated';
  raw?: unknown;
  error?: string;
}

export interface TemplateMessage {
  name: string;
  languageCode: string;
  /** Ordered substitutions for the template's body placeholders. */
  bodyParameters?: string[];
}

export interface InboundMessageEvent {
  kind: 'message';
  providerEventId: string;
  phoneNumberId: string;
  from: string;
  profileName: string | null;
  providerMessageId: string;
  messageType: string;
  text: string | null;
  timestamp: string;
  raw: unknown;
}

export interface InboundStatusEvent {
  kind: 'status';
  providerEventId: string;
  phoneNumberId: string;
  providerMessageId: string;
  status: string;
  timestamp: string;
  raw: unknown;
}

export type InboundEvent = InboundMessageEvent | InboundStatusEvent;

export interface MessagingProvider {
  readonly channel: string;
  readonly mode: MessagingProviderMode;
  sendTextMessage(to: string, text: string): Promise<SendResult>;
  sendTemplateMessage(to: string, template: TemplateMessage): Promise<SendResult>;
  markMessageRead(providerMessageId: string): Promise<void>;
  /** Normalises a raw provider webhook body into channel-agnostic events. */
  processWebhook(payload: unknown): InboundEvent[];
}
