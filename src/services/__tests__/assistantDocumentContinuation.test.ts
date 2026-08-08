import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import {
  inferDocumentContinuationMode,
  isDocumentContinuationAnswerCandidate,
} from '../assistantDocumentContinuation';

const questions = [
  { id: 'q1', text: 'Bakanlık listesini nereden besleyelim?', options: ['Mevcut kaynak', "Yeni Z'li tablo"] },
  { id: 'q2', text: 'Müşteri tipi nasıl davranmalı?', options: ['Otomatik Kamu', 'Validasyon'] },
];

const pendingDocumentMessage: Message = {
  id: 'assistant-1',
  role: 'model',
  text: 'Bu kararları netleştirdiğimizde geliştirme için gerekli ihtiyaç analizi dokümanını doğrudan hazırlayabilirim.',
  questions,
};

const advisoryOnlyMessage: Message = {
  id: 'assistant-2',
  role: 'model',
  text: 'Bu iki kararı netleştirelim; ardından çözüm seçeneklerini karşılaştırırım.',
  questions,
};

const structuredAnswers = [
  '**Soru 1:** Bakanlık listesini nereden besleyelim?\n**Cevap:** Yeni Z\'li tablo\n\n',
  '**Soru 2:** Müşteri tipi nasıl davranmalı?\n**Cevap:** Otomatik Kamu',
].join('');

describe('assistant document continuation', () => {
  it('recognizes the interactive-question answer payload', () => {
    expect(isDocumentContinuationAnswerCandidate(structuredAnswers)).toBe(true);
    expect(isDocumentContinuationAnswerCandidate('Varsayımlarla devam et. Bilinmeyenleri açık konu olarak işaretle.')).toBe(true);
  });

  it('does not classify ordinary follow-up text as an interactive answer payload', () => {
    expect(isDocumentContinuationAnswerCandidate('Bu alan neden gerekli?')).toBe(false);
    expect(isDocumentContinuationAnswerCandidate('Yeni Z tablo olsun')).toBe(false);
  });

  it('continues a promised document workflow after structured answers', () => {
    expect(inferDocumentContinuationMode({
      message: structuredAnswers,
      recentMessages: [pendingDocumentMessage],
      document: null,
    })).toBe('create');
  });

  it('does not turn normal advisory questions into a document', () => {
    expect(inferDocumentContinuationMode({
      message: structuredAnswers,
      recentMessages: [advisoryOnlyMessage],
      document: null,
    })).toBeUndefined();
  });

  it('does not create a second document when Canvas already has content', () => {
    expect(inferDocumentContinuationMode({
      message: structuredAnswers,
      recentMessages: [pendingDocumentMessage],
      document: {
        businessAnalysis: { content: '<p>Mevcut</p>', status: 'DRAFT', flags: [] },
      },
    })).toBeUndefined();
  });

  it('requires the questioned assistant turn to be the immediate pending turn', () => {
    expect(inferDocumentContinuationMode({
      message: structuredAnswers,
      recentMessages: [
        pendingDocumentMessage,
        { id: 'user-interrupt', role: 'user', text: 'Başka bir şey soracağım.' },
      ],
      document: null,
    })).toBeUndefined();
  });
});
