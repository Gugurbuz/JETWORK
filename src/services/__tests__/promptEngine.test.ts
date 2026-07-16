import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, DEFAULT_PROMPT_SETTINGS } from '../promptEngine';

describe('promptEngine', () => {
  it('keeps project context and appends the central decision authority last', () => {
    const prompt = buildSystemPrompt({
      role: 'SYSTEM',
      additionalContext: '[PROJECT WORKING MEMORY]\nproject.goal=Kaynak sadakati',
      settings: {
        ...DEFAULT_PROMPT_SETTINGS,
        systemInstruction: 'Kullanici tarafindan ozellestirilmis persona.',
      },
    });

    expect(prompt).toContain('[PROJECT WORKING MEMORY]');
    expect(prompt).toContain('project.goal=Kaynak sadakati');
    expect(prompt).toContain('[MIMARI OTORITE - EN SON UYGULANACAK KURAL]');
    expect(prompt.lastIndexOf('[MIMARI OTORITE')).toBeGreaterThan(prompt.lastIndexOf('[PROJECT WORKING MEMORY]'));
    expect(prompt).not.toContain('apply_micro_edit');
  });
});
