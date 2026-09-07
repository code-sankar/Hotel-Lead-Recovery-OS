import { describe, expect, it } from 'vitest';
import { RulesAiProvider } from '@/lib/ai/rules-provider';
import { matchFaq } from '@/lib/ai/rules-provider';
import { enforceGuardrails } from '@/lib/ai/guardrails';
import { resolveReadTool, toActionCall } from '@/lib/ai/openai-provider';
import type { ReplyInput } from '@/lib/ai/types';
import { MemoryStore } from './support/memory-store';
import { seedBusiness } from './support/fixtures';

const { knowledge } = seedBusiness(new MemoryStore());

function replyInput(overrides: Partial<ReplyInput> = {}): ReplyInput {
  return {
    message: 'Do you have a room for 15 Sept?',
    history: [],
    knowledge,
    analysis: {
      intent: 'room_availability',
      confidence: 0.85,
      leadTemperature: 'warm',
      entities: { checkIn: '2026-09-15' },
      requiresHuman: false,
      requiresFollowUp: true,
      suggestedAction: 'ask_for_guests',
    },
    leadState: {
      status: 'new',
      score: 35,
      temperature: 'cold',
      checkIn: '2026-09-15',
      checkOut: null,
      guests: null,
      roomPreference: null,
      followUpsSent: 0,
    },
    customerName: 'Rahul Sharma',
    ...overrides,
  };
}

const engine = new RulesAiProvider();

describe('rule-based engine — availability', () => {
  it('never claims a room is available, and says who will confirm', async () => {
    const result = await engine.reply(replyInput());
    const text = result.text ?? '';

    expect(text.toLowerCase()).toContain('confirm availability');
    expect(text).not.toMatch(/yes,? we have .*available/i);

    // And the guardrails agree the reply is safe to send.
    const guarded = enforceGuardrails({ reply: text, knowledge });
    expect(guarded.blocked).toBe(false);
  });

  it('quotes only prices that exist in the hotel record', async () => {
    const result = await engine.reply(replyInput({ analysis: { ...replyInput().analysis, intent: 'pricing' } }));
    const text = result.text ?? '';
    expect(text).toContain('2,800');
    expect(enforceGuardrails({ reply: text, knowledge }).flags).toEqual([]);
  });

  it('is stamped with the engine that wrote it, never a model name', async () => {
    const result = await engine.reply(replyInput());
    expect(result.model).toBe('rules-v1');
    expect(result.provider).toBe('rules');
  });
});

describe('rule-based engine — behaviour', () => {
  it('asks for the guest count once dates are known', async () => {
    const result = await engine.reply(replyInput());
    expect(result.text).toMatch(/how many guests/i);
  });

  it('does not re-ask for details it already has', async () => {
    const result = await engine.reply(
      replyInput({ leadState: { ...replyInput().leadState, guests: 2 } }),
    );
    expect(result.text).not.toMatch(/how many guests/i);
    expect(result.text).not.toMatch(/which dates/i);
  });

  it('uses the guest’s first name', async () => {
    const result = await engine.reply(replyInput());
    expect(result.text).toContain('Rahul');
  });

  it('hands complaints straight to the team without improvising', async () => {
    const input = replyInput({
      message: 'The room was dirty, I want a refund',
      analysis: { ...replyInput().analysis, intent: 'complaint', requiresHuman: true },
    });
    const result = await engine.reply(input);
    expect(result.text).toBe(knowledge.settings.aiEscalationMessage);
    expect(result.toolCalls).toContainEqual({
      name: 'flag_for_human',
      arguments: { reason: 'intent=complaint' },
    });
  });

  it('refuses to invent a discount and escalates instead', async () => {
    const result = await engine.reply(
      replyInput({
        message: 'Any discount available?',
        analysis: { ...replyInput().analysis, intent: 'discount_request' },
      }),
    );
    const text = result.text ?? '';
    expect(text).toMatch(/not able to change rates/i);
    expect(enforceGuardrails({ reply: text, knowledge }).flags).not.toContain('invented_discount');
  });

  it('answers a policy question from the stored policy text', async () => {
    const result = await engine.reply(
      replyInput({
        message: 'What is your cancellation policy?',
        analysis: { ...replyInput().analysis, intent: 'cancellation' },
      }),
    );
    expect(result.text).toContain('Free cancellation up to 48 hours');
  });

  it('acknowledges an opt-out and stops selling', async () => {
    const result = await engine.reply(replyInput({ message: 'Please stop messaging me' }));
    expect(result.text).toMatch(/will not message you again/i);
    expect(result.text).not.toMatch(/₹/);
  });
});

describe('analysis', () => {
  it('flags escalation intents for a human', async () => {
    const analysis = await engine.analyze({
      message: 'I want to speak to a person about my payment',
      history: [],
      knowledge,
    });
    expect(analysis.requiresHuman).toBe(true);
    expect(analysis.suggestedAction).toBe('escalate_to_human');
  });

  it('marks a live enquiry as worth following up', async () => {
    const analysis = await engine.analyze({
      message: 'How much for a deluxe room on 15 Sept?',
      history: [],
      knowledge,
      now: new Date('2026-09-07T10:00:00Z'),
    });
    expect(analysis.requiresFollowUp).toBe(true);
    expect(analysis.entities.checkIn).toBe('2026-09-15');
  });

  it('does not chase someone who asked to be left alone', async () => {
    const analysis = await engine.analyze({
      message: 'Please stop messaging me',
      history: [],
      knowledge,
    });
    expect(analysis.requiresFollowUp).toBe(false);
  });
});

describe('FAQ matching', () => {
  it('finds the matching FAQ', () => {
    expect(matchFaq('Is parking available?', knowledge.faqs)?.question).toBe('Is parking available?');
    expect(matchFaq('is wifi free', knowledge.faqs)?.question).toBe('Is Wi-Fi free?');
  });

  it('returns nothing rather than a weak match', () => {
    expect(matchFaq('Do you have a helipad?', knowledge.faqs)).toBeNull();
    expect(matchFaq('', knowledge.faqs)).toBeNull();
  });
});

describe('model tool surface', () => {
  it('answers read tools from the trusted snapshot only', () => {
    const rooms = resolveReadTool('get_room_types', {}, replyInput()) as Array<{
      name: string;
      base_price: number;
    }>;
    expect(rooms.map((room) => room.name)).toEqual(['Deluxe Room', 'Executive Room', 'Suite']);
    expect(rooms[0]!.base_price).toBe(2800);
  });

  it('tells the model plainly that live availability does not exist', () => {
    const state = resolveReadTool('get_current_conversation_state', {}, replyInput()) as {
      live_availability_available: boolean;
    };
    expect(state.live_availability_available).toBe(false);
  });

  it('refuses to invent a room the hotel does not have', () => {
    const result = resolveReadTool('get_room_details', { room_id: 'made-up' }, replyInput());
    expect(result).toHaveProperty('error');
  });

  it('drops invalid values from a model-requested lead update', () => {
    expect(
      toActionCall('update_lead', { check_in: 'next tuesday', guests: 0, estimated_value: -5 }),
    ).toBeNull();

    expect(toActionCall('update_lead', { check_in: '2026-09-15', guests: 2 })).toEqual({
      name: 'update_lead',
      arguments: { check_in: '2026-09-15', guests: 2 },
    });
  });

  it('ignores a tool the application does not expose', () => {
    expect(toActionCall('delete_everything', {})).toBeNull();
  });
});
