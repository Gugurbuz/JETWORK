import { describe, expect, it } from 'vitest';
import { ARTIFACT_PROFILES } from '../../services/ai/artifactProfiles';
import { CANONICAL_CONCEPTUAL_SECTIONS } from '../../services/conceptualTemplate';
import { evaluateDocumentQualityGate } from '../../services/documentQualityGate';
import { extractProjectMemoryUpdates } from '../../services/ai/projectMemoryEngine';
import { evaluateRevisionInvariant } from '../../services/ai/revisionInvariant';
import { goldenDocuments } from './scenarios';

describe('Sprint 0 known context and quality gaps', () => {
  it('records the current misleading quality-score behavior without changing it', () => {
    const document = structuredDocumentWithOpenReview();
    const result = evaluateDocumentQualityGate(document, {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
      sourceSensitive: false,
    });

    expect(result.score).toBe(100);
    expect(result.canPublishToPanel).toBe(true);
  });

  it('preserves canonical project identity and scope across a follow-up revision', () => {
    const existing = structuredClone(goldenDocuments.existingZcrmDocument);
    const candidate = structuredClone(existing);
    candidate.businessAnalysis.content = '# Doküman Yönetimi\n\nKapsam: Belge yükleme ve validasyon.';

    const result = evaluateRevisionInvariant({
      existing,
      candidate,
      userMessage: 'Mevcut dokümanlar açıkça düzenlenmedikçe etkilenmesin maddesini ekle',
    });

    expect(result.allowed).toBe(false);
  });
  it.todo('penalizes OPEN topics, conflicts, low confidence and NEEDS_REVISION in the quality score');
  it('prevents assistant-generated prose from becoming canonical user-authored project memory', () => {
    const result = extractProjectMemoryUpdates({
      userMessage: 'Bu öneriyi değerlendir.',
      aiMessage: 'Karar: Proje kapsamı belge yönetimi olarak değiştirildi.',
    });
    expect(result).toEqual({});
  });
  it.todo('gives every discovery question distinct, domain-relevant answer options');
  it.todo('keeps locked scope stronger than a recent but unrelated user turn');
  it.todo('asks for a selection instead of running selected-text editing without selected text');
  it.todo('preserves classifier-required clarification through behavior normalization');
  it.todo('routes export requests to workflow instead of document revision');
  it.todo('lets sufficiently detailed technical and test requests proceed without generic blocking questions');
});

function structuredDocumentWithOpenReview() {
  const document = structuredClone(goldenDocuments.existingZcrmDocument);
  const headings = CANONICAL_CONCEPTUAL_SECTIONS
    .map(section => `## ${section}`)
    .join('\n\n');
  document.businessAnalysis.content = [
    headings,
    '| Alan | Değer |',
    '|---|---|',
    '| Kapsam | SAP CRM toplu statü güncelleme |',
    'Karar verilebilir analiz içeriği. '.repeat(80),
  ].join('\n\n');
  document.review = {
    content: [
      '# Review',
      '[AÇIK KONU] Toplu işlem limiti belli değil.',
      '[ÇELİŞKİ] Yetki modeli iki farklı biçimde tarif edildi.',
      'confidence: 0.5',
    ].join('\n'),
    status: 'NEEDS_REVISION',
    flags: ['open-topics', 'conflict'],
  };
  return document;
}
