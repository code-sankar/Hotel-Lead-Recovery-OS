import type { Conversation, Customer, Message, MessageSenderType } from '@/types/domain';
import type { Store } from '@/lib/db/store';
import type { MessagingProvider, TemplateMessage } from '@/lib/messaging/types';
import { decideOutboundKind, type WindowDecision } from '@/lib/messaging/window';

/**
 * The single path every outbound message takes.
 *
 * It enforces the WhatsApp 24-hour service window (free-form vs template),
 * records exactly what happened — including simulated demo sends and failures —
 * and keeps conversation activity timestamps consistent.
 */

export interface SendOutboundInput {
  store: Store;
  provider: MessagingProvider;
  businessId: string;
  conversation: Conversation;
  customer: Customer;
  text: string;
  senderType: MessageSenderType;
  senderUserId?: string | null;
  aiModel?: string | null;
  /** Template configuration to fall back to when the window has closed. */
  templatePurpose?: string | null;
  /** Values for the template's body placeholders, in order. */
  templateParameters?: string[];
  now?: Date;
}

export interface SendOutboundResult {
  status: 'sent' | 'simulated' | 'failed' | 'blocked';
  message: Message | null;
  window: WindowDecision;
  usedTemplate: boolean;
  error?: string;
}

export async function sendOutboundMessage(input: SendOutboundInput): Promise<SendOutboundResult> {
  const now = input.now ?? new Date();
  const window = decideOutboundKind(input.conversation.last_inbound_at, now);

  let template: TemplateMessage | null = null;
  if (window.kind === 'template') {
    if (!input.templatePurpose) {
      return {
        status: 'blocked',
        message: null,
        window,
        usedTemplate: false,
        error:
          'The 24-hour WhatsApp window has closed and no approved template is configured for this message.',
      };
    }
    const configured = await input.store.getWhatsAppTemplate(input.businessId, input.templatePurpose);
    if (!configured?.active) {
      return {
        status: 'blocked',
        message: null,
        window,
        usedTemplate: false,
        error: `No active WhatsApp template configured for "${input.templatePurpose}".`,
      };
    }
    template = {
      name: configured.template_name,
      languageCode: configured.language_code,
      bodyParameters: input.templateParameters,
    };
  }

  const result = template
    ? await input.provider.sendTemplateMessage(input.customer.phone_number, template)
    : await input.provider.sendTextMessage(input.customer.phone_number, input.text);

  const message = await input.store.insertMessage({
    businessId: input.businessId,
    conversationId: input.conversation.id,
    direction: 'outbound',
    senderType: input.senderType,
    senderUserId: input.senderUserId ?? null,
    messageType: template ? 'template' : 'text',
    text: input.text,
    providerMessageId: result.providerMessageId,
    templateName: template?.name ?? null,
    deliveryStatus:
      result.status === 'sent' ? 'sent' : result.status === 'simulated' ? 'simulated' : 'failed',
    aiModel: input.aiModel ?? null,
    rawPayload: result.raw ?? null,
    error: result.error ?? null,
  });

  if (result.status !== 'failed') {
    await input.store.updateConversation(input.businessId, input.conversation.id, {
      last_outbound_at: now.toISOString(),
      last_message_at: now.toISOString(),
      last_message_preview: previewOf(input.text),
    });
  }

  return {
    status: result.status === 'failed' ? 'failed' : result.status,
    message,
    window,
    usedTemplate: Boolean(template),
    error: result.error,
  };
}

export function previewOf(text: string | null | undefined, limit = 140): string {
  if (!text) return '';
  const normalised = text.replace(/\s+/g, ' ').trim();
  return normalised.length > limit ? `${normalised.slice(0, limit - 1)}…` : normalised;
}
