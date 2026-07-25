import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { evaluateRevisionInvariant } from '../../services/ai/revisionInvariant';

const existing: DocumentData = {
  businessAnalysis: {
    content: [
      '# ZCRM110 Toplu Statü Güncelleme',
      'Kapsam: SAP CRM teklif kayıtlarının toplu statü güncellemesi.',
      'Kısıt: Legacy Support dokümanları açıkça düzenlenmedikçe değişmeden kalır.',
    ].join('\n'),
    status: 'APPROVED',
    flags: [],
  },
  review: {
    content: '[AÇIK KONU] Toplu işlem limiti.',
    status: 'NEEDS_REVISION',
    flags: [],
  },
};

describe('Sprint 1 revision invariant', () => {
  it('blocks the project-identity drift reproduced in the live test', () => {
    const candidate: DocumentData = {
      businessAnalysis: {
        content: [
          '# Kurumsal Doküman Yönetimi ve Validasyon',
          'Kapsam: Belgelerin yüklenmesi, saklanması ve doğrulanması.',
          'Legacy Support dokümanları etkilenmez.',
        ].join('\n'),
        status: 'DRAFT',
        flags: [],
      },
      review: existing.review,
    };

    const result = evaluateRevisionInvariant({
      existing,
      candidate,
      userMessage: 'Mevcut dokümanlar açıkça düzenlenmedikçe etkilenmesin maddesini ekle',
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.join(' ')).toMatch(/ZCRM110|Proje kimliği/);
  });

  it('allows an explicit project rename and scope change', () => {
    const candidate: DocumentData = {
      businessAnalysis: {
        content: '# Kurumsal Doküman Yönetimi\nKapsam: Belge doğrulama.',
        status: 'DRAFT',
        flags: [],
      },
    };

    const result = evaluateRevisionInvariant({
      existing,
      candidate,
      userMessage: 'Proje adını Kurumsal Doküman Yönetimi olarak değiştir ve kapsamı yeniden yaz.',
    });

    expect(result.allowed).toBe(true);
  });
});
