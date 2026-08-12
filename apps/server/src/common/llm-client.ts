// ─── LLM Client ──────────────────────────────────────────────────────────────
// Provider-agnostic wrapper. Callers pick a provider; each adapter handles the
// SDK specifics. Pure functions, no NestJS dependencies — Lambda-extractable.

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export type LLMProvider = 'anthropic' | 'gemini' | 'openai';

export interface GenerateParams {
  systemPrompt: string;
  userMessage: string;
  provider?: LLMProvider;
  model?: string;
  maxTokens?: number;
  apiKey: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
};

/**
 * Call an LLM with a system prompt and user message.
 * Returns the text response.
 */
export async function generateWithLLM(params: GenerateParams): Promise<string> {
  const {
    systemPrompt,
    userMessage,
    provider = 'anthropic',
    model = DEFAULT_MODELS[provider],
    maxTokens = 4096,
    apiKey,
  } = params;

  const start = Date.now();
  console.log(`[llm] → ${provider}/${model} (${userMessage.length} chars)`);

  try {
    const text = await callProvider({ provider, model, maxTokens, apiKey, systemPrompt, userMessage });
    console.log(`[llm] ← ${provider}/${model} OK ${Date.now() - start}ms (${text.length} chars)`);
    return text;
  } catch (err) {
    console.error(`[llm] ✗ ${provider}/${model} FAILED ${Date.now() - start}ms`, err instanceof Error ? err.message : err);
    throw err;
  }
}

async function callProvider(params: {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
}): Promise<string> {
  const { provider, model, maxTokens, apiKey, systemPrompt, userMessage } = params;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMessage },
  ];

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(apiKey);
    const gemini = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt });
    const result = await gemini.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    });
    return result.response.text();
  }

  let response;

  switch (provider) {
    case 'anthropic': {
      const llm = new ChatAnthropic({ model, maxTokens, anthropicApiKey: apiKey });
      response = await llm.invoke(messages);
      break;
    }
    case 'openai': {
      const llm = new ChatOpenAI({ model, maxTokens, openAIApiKey: apiKey });
      response = await llm.invoke(messages);
      break;
    }
  }

  return typeof response!.content === 'string'
    ? response!.content
    : response!.content.map((c) => ('text' in c ? c.text : '')).join('');
}
