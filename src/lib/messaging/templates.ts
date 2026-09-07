/**
 * WhatsApp message template configuration.
 *
 * Meta requires an approved template for any outbound message sent outside the
 * 24-hour customer service window — which is exactly where automated follow-ups
 * land. The application stores only the template IDENTIFIER per purpose; the
 * template itself must be created and approved in the hotel's WhatsApp Business
 * account before live follow-ups can go out. Until then, live sends fail with
 * Meta's own error and the follow-up is recorded as failed rather than silently
 * dropped. In demo mode nothing reaches Meta at all.
 */

export const DEFAULT_TEMPLATE_PURPOSES = ['follow_up_1', 'follow_up_2', 'reengagement'] as const;

export type TemplatePurpose = (typeof DEFAULT_TEMPLATE_PURPOSES)[number];

export const TEMPLATE_PURPOSE_LABELS: Record<TemplatePurpose, string> = {
  follow_up_1: 'First follow-up',
  follow_up_2: 'Second follow-up',
  reengagement: 'Re-engagement / general reply outside the 24h window',
};

/**
 * The body each template is expected to contain, in order of its placeholders.
 * Shown in settings so the hotel can submit a matching template to Meta.
 */
export const TEMPLATE_BODY_GUIDANCE: Record<TemplatePurpose, string> = {
  follow_up_1:
    'Hi {{1}}, just checking whether you had a chance to look at the room options at {{2}}. Happy to help with the booking whenever you are ready.',
  follow_up_2:
    'Hi {{1}}, we are happy to help with your stay at {{2}} whenever you are ready. Would you like me to keep your enquiry open?',
  reengagement:
    'Hi {{1}}, this is {{2}}. We have an update on your enquiry — reply here and we will continue.',
};
