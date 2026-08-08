import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { deriveDocumentQuality, withDerivedDocumentQuality } from '../documentQualityScore';

const detailedDocument: DocumentData = {
  businessAnalysis: {
    status: 'DRAFT',
    flags: [],
    content: `
      <h1>İHTİYAÇ ANALİZİ</h1>
      <h2>1. ANALİZ KAPSAMI</h2>
      <h2>2. KISALTMALAR</h2>
      <h2>3. İŞ GEREKSİNİMLERİ</h2>
      <h3>3.1. İş Kuralları</h3><p>BR-1: Onay olmadan işlem yapılamaz.</p>
      <h2>4. FONKSİYONEL GEREKSİNİMLER (FR)</h2><p>FR-1: Talep listelenir.</p>
      <h3>4.2. Süreç Akışı</h3><ol><li>Talebin alınması</li></ol>
      <h2>5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)</h2>
      <h3>5.1. Güvenlik ve Yetkilendirme Gereksinimleri</h3><p>Rol bazlı yetki.</p>
      <h3>5.3. Raporlama Gereksinimleri</h3><p>KPI: Tamamlanma süresi.</p>
      <h2>6. SÜREÇ RİSK ANALİZİ</h2>
      <h2>7. ONAY</h2>
      <h2>8. FONKSİYONEL TASARIM DOKÜMANLARI</h2>
      <p>[AÇIK KONU]</p>
    `,
  },
};

describe('document quality score', () => {
  it('scores a structurally complete Enerjisa artifact above the publish-quality threshold', () => {
    const quality = deriveDocumentQuality(detailedDocument);
    expect(quality.sectionCoverage).toBe(100);
    expect(quality.score).toBeGreaterThanOrEqual(72);
    expect(quality.explanation).toContain('Şablon kapsamı %100');
  });

  it('hydrates missing score without overriding an explicit score', () => {
    const derived = withDerivedDocumentQuality(detailedDocument);
    expect(derived.score).toBeGreaterThanOrEqual(72);
    expect(derived.scoreExplanation).toBeTruthy();

    const explicit = withDerivedDocumentQuality({ ...detailedDocument, score: 91, scoreExplanation: 'Manuel değerlendirme' });
    expect(explicit.score).toBe(91);
    expect(explicit.scoreExplanation).toBe('Manuel değerlendirme');
  });
});
