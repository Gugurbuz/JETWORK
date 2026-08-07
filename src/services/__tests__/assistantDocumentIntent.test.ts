import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import {
  buildDocumentGenerationMessage,
  ENERJISA_REQUIRED_DOCUMENT_MARKERS,
  isExplicitDocumentCreationRequest,
  isExplicitDocumentRevisionRequest,
  parseAssistantDocumentDraft,
  resolveAssistantDocumentRequestMode,
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

const existingDocument = {
  businessAnalysis: {
    content: '<h1>İHTİYAÇ ANALİZİ</h1><h2>1. ANALİZ KAPSAMI</h2><p>Satışçı işlemi başlatır.</p>',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: '<p>Açık konu: Yetki matrisi.</p>',
    status: 'DRAFT',
    flags: [],
  },
} as DocumentData;

describe('assistant document intent', () => {
  it.each([
    'Analiz oluştur',
    'BA analizi hazırla',
    'Bu konuşmadan iş analizi dokümanı üret',
    'Kavramsal tasarım belgesi yaz',
    'Talep dokümanına dönüştür',
  ])('routes explicit document creation request: %s', message => {
    expect(resolveAssistantDocumentRequestMode(message, null)).toBe('create');
  });

  it.each([
    'Bu konuyu analiz et',
    'Mevcut analizi değerlendir',
    'Eksikleri söyle',
    'Doküman hakkında ne düşünüyorsun?',
    'Kavramsal tasarım nedir?',
    'Şu an bu konuşmada daha önce oluşturulan proje analiz dokümanını bana özetle',
    'Daha önce oluşturduğumuz dokümanı özetle',
    'Oluşturulmuş iş analizi belgesini bana göster',
    'Hazırlanan analiz dokümanını değerlendir',
  ])('keeps conversational and historical document requests in chat: %s', message => {
    expect(resolveAssistantDocumentRequestMode(message, null)).toBe('none');
    expect(resolveAssistantDocumentRequestMode(message, existingDocument)).toBe('none');
  });

  it.each([
    'Bu başlığı düzelt',
    '3.2 bölümüne onay adımını ekle',
    'FR-4 maddesini sil',
    'Satışçı yerine satış uzmanı yaz',
    'Dokümanı daha kısa ve profesyonel yap',
    'Buradaki rol adını güncelle',
  ])('routes an imperative edit to the existing document: %s', message => {
    expect(isExplicitDocumentRevisionRequest(message, existingDocument)).toBe(true);
    expect(resolveAssistantDocumentRequestMode(message, existingDocument)).toBe('revise');
  });

  it.each([
    'Ürün adı aslında lrtv5 olmalı',
    'Doğrusu LRT-V5',
    'LRT-V4 değil LRT-V5',
    'Bundan sonra adı LRTV5 olacak',
    'Burada satışçı değil satış uzmanı yazmalı',
    'Bu alan CRM değil C4C',
    'FR-3te tarih 01.09 olmalı',
  ])('routes a natural-language correction to the existing document: %s', message => {
    expect(isExplicitDocumentRevisionRequest(message, existingDocument)).toBe(true);
    expect(resolveAssistantDocumentRequestMode(message, existingDocument)).toBe('revise');
  });

  it.each([
    'Bu cevabı daha kısa yaz',
    'Son mesajını düzelt',
    'Sence dokümanda ne değişmeli?',
    'Nasıl güncellemeliyiz?',
    'Mevcut analizi değerlendir',
    'Ürün adı ne olmalı?',
    'Bu alan CRM değil mi?',
    'Nasıl olmalı?',
  ])('keeps chat and advisory requests out of document versioning: %s', message => {
    expect(isExplicitDocumentRevisionRequest(message, existingDocument)).toBe(false);
  });

  it('does not route a revision when no document exists', () => {
    expect(isExplicitDocumentRevisionRequest('Bu başlığı düzelt', null)).toBe(false);
  });

  it('keeps the legacy boolean entry point compatible for creation requests', () => {
    expect(isExplicitDocumentCreationRequest('Analiz oluştur')).toBe(true);
  });

  it('adds the complete Enerjisa template and deterministic output blocks', () => {
    const prompt = buildDocumentGenerationMessage('Analiz oluştur', null);

    ENERJISA_REQUIRED_DOCUMENT_MARKERS.forEach(marker => {
      expect(prompt).toContain(marker);
    });
    expect(prompt).toContain('<ba_analysis>');
    expect(prompt).toContain('</ba_analysis>');
    expect(prompt).toContain('<review>');
    expect(prompt).toContain('</review>');
  });

  it('builds a full-document revision contract with the current Canvas content', () => {
    const prompt = buildDocumentGenerationMessage(
      'Satışçı yerine satış uzmanı yaz',
      existingDocument,
    );

    expect(prompt).toContain('mevcut Enerjisa ihtiyaç analizi dokümanında değişiklik');
    expect(prompt).toContain('Satışçı işlemi başlatır.');
    expect(prompt).toContain('Açık konu: Yetki matrisi.');
    expect(prompt).toContain('Yalnız kullanıcının istediği değişikliği uygula');
    expect(prompt).toContain('değişiklik uygulanmış TAM dokümanı');
    expect(prompt).toContain('<current_business_analysis format="html">');
    ENERJISA_REQUIRED_DOCUMENT_MARKERS.forEach(marker => {
      expect(prompt).toContain(marker);
    });
  });

  it('builds the same revision contract for a natural correction', () => {
    const prompt = buildDocumentGenerationMessage(
      'Ürün adı aslında lrtv5 olmalı',
      existingDocument,
    );

    expect(prompt).toContain('mevcut Enerjisa ihtiyaç analizi dokümanında değişiklik');
    expect(prompt).toContain('Ürün adı aslında lrtv5 olmalı');
    expect(prompt).toContain('<current_business_analysis format="html">');
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