import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { preserveArtifactDecisions } from '../artifactPreservation';

const document = (content: string, review = ''): DocumentData => ({
  businessAnalysis: { content, status: 'DRAFT', flags: [] },
  ...(review ? { review: { content: review, status: 'DRAFT', flags: [] } } : {}),
});

describe('artifact decision preservation', () => {
  it('keeps protected decisions that a generated revision omitted', () => {
    const result = preserveArtifactDecisions(
      document('# Kararlar\nAna kayıt sistemi SAP CRM’dir.\nMüşteri tipi manuel değiştirilemez.'),
      document('# Süreç\nKuyruk üç kez yeniden denenir.'),
      'Kuyruk yeniden deneme sürecini ayrıntılandır.',
      'businessAnalysis',
    );

    expect(result.businessAnalysis?.content).toContain('Ana kayıt sistemi SAP CRM’dir.');
    expect(result.businessAnalysis?.content).toContain('Müşteri tipi manuel değiştirilemez.');
  });

  it('does not re-add a decision explicitly superseded by the user', () => {
    const result = preserveArtifactDecisions(
      document('# Karar\nİade limiti 5.000 TL.'),
      document('# Karar\nİade limiti 10.000 TL.'),
      'Karar: iade limiti artık 10.000 TL.',
      'businessAnalysis',
    );

    expect(result.businessAnalysis?.content).not.toContain('5.000 TL');
  });

  it('keeps business analysis byte-for-byte during a review-only update', () => {
    const existing = document('# Kesin Karar\nKimlik doğrulama kurumsal SSO ile yapılır.', '# Review\nEski');
    const result = preserveArtifactDecisions(
      existing,
      document('# Yanlışlıkla değişen BA', '# Review\nYeni risk'),
      'Yalnız Review bölümüne risk ekle.',
      'review',
    );

    expect(result.businessAnalysis).toEqual(existing.businessAnalysis);
    expect(result.review?.content).toContain('Yeni risk');
    expect(result.review?.content).toContain('DOĞRULANMIŞ GERÇEK · VARSAYIM · AÇIK KONU');
    expect(result.review?.content).toContain('Yalnız Review bölümüne risk ekle.');
  });

  it('keeps an explicit user decision verbatim in a new artifact', () => {
    const result = preserveArtifactDecisions(
      null,
      document('# Veri Sahipliği\nCRM tek yetkili kaynaktır.'),
      'Karar: müşteri tipini yalnız CRM belirler.',
      'businessAnalysis',
    );

    expect(result.businessAnalysis?.content).toContain('müşteri tipini yalnız CRM belirler.');
  });

  it('keeps Turkish inflected decision statements from the existing artifact', () => {
    const result = preserveArtifactDecisions(
      document('# İade Süreci\nFinans onayı uygulanacaktır.'),
      document('# İade Süreci\n50.000 TL üzeri finans yöneticisine yönlendirilir.'),
      'Üst limit 50.000 TL olsun.',
      'businessAnalysis',
    );

    expect(result.businessAnalysis?.content).toContain('Finans onayı uygulanacaktır.');
  });

  it('records the mutation request verbatim for artifact traceability', () => {
    const result = preserveArtifactDecisions(
      document('# İş Kuralları\nLimit aşılırsa ikinci onay gerekir.'),
      document('# Testler\nPozitif ve negatif senaryolar eklendi.'),
      'Mevcut kurallar için test edilebilir kabul kriterleri ve hata senaryolarını ekle.',
      'businessAnalysis',
    );

    expect(result.businessAnalysis?.content).toContain('## Talep İzlenebilirliği');
    expect(result.businessAnalysis?.content).toContain('kabul kriterleri ve hata senaryolarını ekle');
  });
});
