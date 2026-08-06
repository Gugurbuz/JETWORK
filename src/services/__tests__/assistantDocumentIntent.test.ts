import { describe, expect, it } from 'vitest';
import {
  buildDocumentGenerationMessage,
  ENERJISA_REQUIRED_DOCUMENT_MARKERS,
  isExplicitDocumentCreationRequest,
  parseAssistantDocumentDraft,
  validateEnerjisaDocumentContract,
} from '../assistantDocumentIntent';

const validEnerjisaDocument = `
| İş Analizi Dokümanı | Talep Adı |
|---|---|
| Talep No | SAGILE-00000 |

## İçindekiler

# İHTİYAÇ ANALİZİ
## 1. ANALİZ KAPSAMI
Kapsam.
## 2. KISALTMALAR
Kısaltmalar.
## 3. İŞ GEREKSİNİMLERİ
Gereksinimler.
## 4. FONKSİYONEL GEREKSİNİMLER (FR)
FR-1.
## 5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)
NFR-1.
## 6. SÜREÇ RİSK ANALİZİ
Riskler.
## 7. ONAY
Onay.
## 8. FONKSİYONEL TASARIM DOKÜMANLARI
Tasarım.
`;

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

  it('adds the complete Enerjisa template and deterministic output blocks', () => {
    const prompt = buildDocumentGenerationMessage('Analiz oluştur');

    ENERJISA_REQUIRED_DOCUMENT_MARKERS.forEach(marker => {
      expect(prompt).toContain(marker);
    });
    expect(prompt).toContain('<ba_analysis>');
    expect(prompt).toContain('</ba_analysis>');
    expect(prompt).toContain('<review>');
    expect(prompt).toContain('</review>');
  });

  it('parses BA analysis and review blocks separately', () => {
    const draft = parseAssistantDocumentDraft(`
<ba_analysis>
${validEnerjisaDocument}
</ba_analysis>
<review>
- Açık konu: Yetki matrisi
</review>
    `);

    expect(draft.businessAnalysisMarkdown).toContain('# İHTİYAÇ ANALİZİ');
    expect(draft.businessAnalysisMarkdown).not.toContain('Yetki matrisi');
    expect(draft.reviewMarkdown).toContain('Yetki matrisi');
  });

  it('accepts the complete Enerjisa document contract', () => {
    expect(validateEnerjisaDocumentContract(validEnerjisaDocument)).toEqual({
      valid: true,
      missingMarkers: [],
    });
  });

  it('rejects a generic BA document that omits Enerjisa sections', () => {
    const validation = validateEnerjisaDocumentContract(`
# İş Analizi
## Amaç
Süreç geliştirilecek.
## Gereksinimler
- Yeni alan eklenecek.
    `);

    expect(validation.valid).toBe(false);
    expect(validation.missingMarkers).toContain('## 1. ANALİZ KAPSAMI');
    expect(validation.missingMarkers).toContain('## 7. ONAY');
    expect(validation.missingMarkers).toContain('## 8. FONKSİYONEL TASARIM DOKÜMANLARI');
  });

  it('falls back to the full response when tags are missing', () => {
    const draft = parseAssistantDocumentDraft(validEnerjisaDocument);
    expect(draft.businessAnalysisMarkdown).toBe(validEnerjisaDocument.trim());
    expect(draft.reviewMarkdown).toBe('');
  });
});
