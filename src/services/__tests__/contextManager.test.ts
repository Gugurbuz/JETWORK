import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '../../types';
import { extractKeywords, hybridSearch } from '../contextManager';

describe('contextManager retrieval', () => {
  it('keeps business-analysis domain words searchable', () => {
    const keywords = extractKeywords('Bir iş sistemi için veri ve belge kuralı');

    expect(keywords).toEqual(expect.arrayContaining(['iş', 'sistemi', 'veri', 'belge', 'kuralı']));
    expect(keywords).not.toContain('bir');
    expect(keywords).not.toContain('ve');
    expect(keywords).not.toContain('için');
  });

  it('searches item content even when stored keywords are incomplete', () => {
    const items: KnowledgeItem[] = [
      {
        id: 'crm',
        content: 'SAP CRM müşteri tipi iş kuralı kurumsal müşteriler için güncellendi',
        keywords: ['sap'],
        importance: 8,
        createdAt: 1,
        projectId: 'w1',
      },
      {
        id: 'billing',
        content: 'Faturalama ekranı renk tercihi',
        keywords: ['ekran'],
        importance: 10,
        createdAt: 2,
        projectId: 'w1',
      },
    ];

    expect(hybridSearch('CRM müşteri tipi iş kuralı', items, 1)[0]?.id).toBe('crm');
  });
});
