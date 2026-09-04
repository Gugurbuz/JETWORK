import { describe, expect, it } from 'vitest';
import { applyGeminiThinkingGuardBody } from '../../../supabase/functions/_shared/geminiThinkingGuard';

const flashUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const flashStreamUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse';

describe('Gemini bounded final synthesis thinking guard', () => {
  it('adds minimal thinking only to cost-guard no-tool final synthesis', () => {
    const body = {
      systemInstruction: { parts: [{ text: '[JETWORK_COST_GUARD] Araştırma tamamlandı.' }] },
      contents: [{ role: 'user', parts: [{ text: 'kanıt' }] }],
      generationConfig: { maxOutputTokens: 1200 },
    };

    const result = applyGeminiThinkingGuardBody(flashUrl, body);

    expect(result).not.toBe(body);
    expect((result.generationConfig as any).thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });

  it('also applies minimal thinking to the streaming Gemini endpoint', () => {
    const body = {
      systemInstruction: { parts: [{ text: '[JETWORK_COST_GUARD] Araştırma tamamlandı.' }] },
      contents: [{ role: 'user', parts: [{ text: 'kanıt' }] }],
      generationConfig: { maxOutputTokens: 1200 },
    };

    const result = applyGeminiThinkingGuardBody(flashStreamUrl, body);

    expect(result).not.toBe(body);
    expect((result.generationConfig as any).thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
  });

  it('does not change tool-enabled agent calls', () => {
    const body = {
      systemInstruction: { parts: [{ text: '[JETWORK_COST_GUARD] Araştırma tamamlandı.' }] },
      tools: [{ functionDeclarations: [{ name: 'search_knowledge_catalog' }] }],
      generationConfig: {},
    };

    expect(applyGeminiThinkingGuardBody(flashStreamUrl, body)).toBe(body);
  });

  it('preserves an explicit thinking policy', () => {
    const body = {
      systemInstruction: { parts: [{ text: '[JETWORK_COST_GUARD] Araştırma tamamlandı.' }] },
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    };

    expect(applyGeminiThinkingGuardBody(flashStreamUrl, body)).toBe(body);
  });

  it('does not change unrelated Gemini calls', () => {
    const body = {
      systemInstruction: { parts: [{ text: 'normal synthesis' }] },
      generationConfig: {},
    };

    expect(applyGeminiThinkingGuardBody(flashStreamUrl, body)).toBe(body);
  });
});
