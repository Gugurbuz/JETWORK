import { describe, expect, it } from 'vitest';
import {
  buildDocumentGenerationMessage,
  isExplicitDocumentCreationRequest,
  parseAssistantDocumentDraft,
} from '../assistantDocumentIntent';

describe('assistant document intent', () => {
  it.each([
    'Analiz oluştur',
    'BA analizi hazırla',
    'Bu konuşmadan iş analizi dokümanı üret',
    'Kavramsal tasarım belgesi yaz',
    'Talep dokümanına dönüştür',
  ])('routes explicit document creation request: %s', message => {
    expect(isExplicitDocumentCreationRequest(message)).toBe(true);
  });

  it.each([
    'Bu konuyu analiz et',
    'Mevcut analizi değerlendir',
    'Eksikleri söyle',
    'Doküman hakkında ne düşünüyorsun?',
    'Kavramsal tasarım nedir?',
  ])('keeps conversational analysis request in chat: %s', message => {
    expect(isExplicitDocumentCreationRequest(message)).toBe(false);
  });

  it('adds a deterministic two-section generation contract', () => {
    const prompt = buildDocumentGenerationMessage('Analiz oluştur');
    expect(prompt).toContain('<ba_analysis>');
    expect(prompt).toContain('</ba_analysis>');
    expect(prompt).toContain('<review>');
    expect(prompt).toContain('</review>');
  });

  it('parses BA analysis and review blocks separately', () => {
    const draft = parseAssistantDocumentDraft(`
<ba_analysis>
# Amaç
Süreç iyileştirilecek.
</ba_analysis>
<review>
- Açık konu: Yetki matrisi
</review>
    `);

    expect(draft.businessAnalysisMarkdown).toContain('# Amaç');
    expect(draft.businessAnalysisMarkdown).not.toContain('Açık konu');
    expect(draft.reviewMarkdown).toContain('Yetki matrisi');
  });

  it('falls back to the full response when tags are missing', () => {
    const draft = parseAssistantDocumentDraft('# BA Analiz\nİçerik');
    expect(draft.businessAnalysisMarkdown).toBe('# BA Analiz\nİçerik');
    expect(draft.reviewMarkdown).toBe('');
  });
});
