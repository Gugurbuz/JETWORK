import { describe, expect, it } from 'vitest';
import {
  buildDocumentGenerationMessage,
  isSparseDocumentCreationRequest,
} from '../assistantDocumentIntent';

describe('sparse document discovery gate', () => {
  const sparse = 'Saha servis is emirlerinin mobil uygulamaya tasinmasi projesi icin kavramsal tasarim dokumani hazirla.';

  it('routes a sparse one-sentence document request to discovery instead of full artifact generation', () => {
    expect(isSparseDocumentCreationRequest(sparse, null)).toBe(true);

    const prompt = buildDocumentGenerationMessage(sparse, null);
    expect(prompt).toContain('<jetwork_meta>');
    expect(prompt).toContain('"options":[]');
    expect(prompt).not.toMatch(/(?:^|\n)<ba_analysis>\s*(?:\n|$)/);
    expect(prompt).not.toMatch(/(?:^|\n)<review>\s*(?:\n|$)/);
  });

  it('keeps a detailed structured request on the full document path', () => {
    const detailed = [
      'Problem: Abonelik iptal ve iade talepleri farkli kanallarda izlenemiyor.',
      'Mevcut durum: Cagri merkezi ve operasyon ekipleri ayri listeler kullaniyor.',
      'Hedef durum: Talepleri tek is listesinde izlemek.',
      'Surec 1 - Iptal talebinin alinmasi',
      'Roller: Musteri temsilcisi, operasyon uzmani.',
      'Is kurali: Onay olmadan iade yapilamaz.',
      'Kurumsal is analizi dokumani hazirla.',
    ].join('\n');

    expect(isSparseDocumentCreationRequest(detailed, null)).toBe(false);
    const prompt = buildDocumentGenerationMessage(detailed, null);
    expect(prompt).toContain('<ba_analysis>');
    expect(prompt).toContain('<review>');
  });

  it('does not force very short continuation-like commands into generic discovery', () => {
    const continuation = 'Analiz dokümanını oluştur';
    expect(isSparseDocumentCreationRequest(continuation, null)).toBe(false);
  });
});
