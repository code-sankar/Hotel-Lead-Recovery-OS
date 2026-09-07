import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  InboundEvent,
  MessagingProvider,
  SendResult,
  TemplateMessage,
} from './types';

/**
 * Meta WhatsApp Business Platform (Cloud API) provider.
 *
 * Official API only — no WhatsApp Web automation, no browser drivers, and no
 * customer credentials are ever stored.
 */

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_VERSION = 'v21.0';

export class WhatsAppCloudProvider implements MessagingProvider {
  readonly channel = 'whatsapp';
  readonly mode = 'live' as const;

  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: WhatsAppCloudConfig) {
    this.accessToken = config.accessToken;
    this.phoneNumberId = config.phoneNumberId;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private get endpoint(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          providerMessageId: null,
          status: 'failed',
          raw: payload,
          error: describeGraphError(payload, response.status),
        };
      }

      return {
        providerMessageId: extractMessageId(payload),
        status: 'sent',
        raw: payload,
      };
    } catch (error) {
      return {
        providerMessageId: null,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sendTextMessage(to: string, text: string): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    });
  }

  async sendTemplateMessage(to: string, template: TemplateMessage): Promise<SendResult> {
    const components = template.bodyParameters?.length
      ? [
          {
            type: 'body',
            parameters: template.bodyParameters.map((value) => ({ type: 'text', text: value })),
          },
        ]
      : undefined;

    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.languageCode },
        ...(components ? { components } : {}),
      },
    });
  }

  async markMessageRead(providerMessageId: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: providerMessageId,
    });
  }

  processWebhook(payload: unknown): InboundEvent[] {
    return parseWhatsAppWebhook(payload);
  }
}

function extractMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const messages = (payload as { messages?: Array<{ id?: string }> }).messages;
  return messages?.[0]?.id ?? null;
}

function describeGraphError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: { message?: string; code?: number } }).error;
    if (error?.message) return `WhatsApp API error ${error.code ?? status}: ${error.message}`;
  }
  return `WhatsApp API request failed with HTTP ${status}`;
}

// ---------------------------------------------------------------------------
// Webhook parsing
// ---------------------------------------------------------------------------

interface RawValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: RawMessage[];
  statuses?: RawStatus[];
}

interface RawMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

interface RawStatus {
  id?: string;
  status?: string;
  timestamp?: string;
}

/** Text a customer effectively "said", including button and list replies. */
function messageText(message: RawMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return null;
}

function toIso(timestamp: string | undefined): string {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

/**
 * Normalises a Cloud API webhook body. Meta batches several entries and
 * changes per delivery, so this always returns an array.
 */
export function parseWhatsAppWebhook(payload: unknown): InboundEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const entries = (payload as { entry?: Array<{ changes?: Array<{ value?: RawValue }> }> }).entry;
  if (!Array.isArray(entries)) return [];

  const events: InboundEvent[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const contactName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        events.push({
          kind: 'message',
          providerEventId: message.id,
          phoneNumberId,
          from: message.from,
          profileName: contactName,
          providerMessageId: message.id,
          messageType: message.type ?? 'unsupported',
          text: messageText(message),
          timestamp: toIso(message.timestamp),
          raw: message,
        });
      }

      for (const status of value.statuses ?? []) {
        if (!status.id || !status.status) continue;
        events.push({
          kind: 'status',
          // Status updates repeat per state, so the event id includes the state.
          providerEventId: `${status.id}:${status.status}`,
          phoneNumberId,
          providerMessageId: status.id,
          status: status.status,
          timestamp: toIso(status.timestamp),
          raw: status,
        });
      }
    }
  }

  return events;
}

/**
 * Verifies Meta's X-Hub-Signature-256 header against the raw request body.
 * The raw body string must be used — re-serialising the parsed JSON changes
 * the bytes and breaks the signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [scheme, signature] = signatureHeader.split('=');
  if (scheme !== 'sha256' || !signature) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length || expectedBuffer.length === 0) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/** Meta's GET verification handshake. */
export function verifyWebhookChallenge(
  params: URLSearchParams,
  expectedVerifyToken: string,
): { ok: boolean; challenge?: string } {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode === 'subscribe' && token && expectedVerifyToken && token === expectedVerifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/** Digits-only E.164-ish normalisation used as the customer key. */
export function normalisePhoneNumber(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}
