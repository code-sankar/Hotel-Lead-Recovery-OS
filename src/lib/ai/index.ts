import { serverEnv } from '@/lib/env';
import { OpenAiProvider } from './openai-provider';
import { RulesAiProvider } from './rules-provider';
import type { AiProvider } from './types';

export * from './types';
export { RulesAiProvider } from './rules-provider';
export { OpenAiProvider } from './openai-provider';

/**
 * Resolves the conversation engine.
 *
 * With an OpenAI key configured the OpenAI provider is used and its failures
 * fall back to the deterministic engine rather than dropping the customer's
 * message. Without a key the deterministic engine is used outright — and every
 * message it writes is stamped `rules-v1`, never a model name.
 */
export function createAiProvider(): AiProvider {
  const env = serverEnv();
  if (!env.OPENAI_API_KEY) return new RulesAiProvider();
  return new ResilientAiProvider(new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL));
}

export class ResilientAiProvider implements AiProvider {
  private readonly fallback = new RulesAiProvider();

  constructor(private readonly primary: AiProvider) {}

  get name(): string {
    return this.primary.name;
  }

  get model(): string {
    return this.primary.model;
  }

  async analyze(input: Parameters<AiProvider['analyze']>[0]) {
    try {
      return await this.primary.analyze(input);
    } catch (error) {
      console.error('[ai] analyze failed, using rule-based classifier', error);
      return this.fallback.analyze(input);
    }
  }

  async reply(input: Parameters<AiProvider['reply']>[0]) {
    try {
      const result = await this.primary.reply(input);
      if (result.text) return result;
      throw new Error('empty response');
    } catch (error) {
      console.error('[ai] reply failed, using rule-based engine', error);
      const fallbackResult = await this.fallback.reply(input);
      return {
        ...fallbackResult,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
