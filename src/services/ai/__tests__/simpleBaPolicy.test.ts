import { describe, expect, it } from 'vitest';
import { decideSimpleBaTurn } from '../simpleBaPolicy';

const decide = (
  userMessage: string,
  options: { hasDocument?: boolean; hasSelectedText?: boolean; knowledgeItemCount?: number } = {},
) => decideSimpleBaTurn({
  userMessage,
  hasDocument: options.hasDocument || false,
  hasSelectedText: options.hasSelectedText,
  knowledgeItemCount: options.knowledgeItemCount,
});

describe('simple BA interaction policy', () => {
  it('keeps a normal greeting and general question chat-only', () => {
    expect(decide('Merhaba, nasılsın?').action).toBe('ANSWER');
    expect(decide('Fonksiyonel gereksinim nedir?').action).toBe('ANSWER');
  });

  it('matures a sparse project request without creating a document', () => {
    const result = decide('CRM ile yeni bir entegrasyon istiyorum');
    expect(result.caseType).toBe('PROJECT');
    expect(result.action).toBe('ASK');
    expect(result.documentRequested).toBe(false);
    expect(result.questions).toHaveLength(3);
  });

  it('matures an underspecified support issue without creating a document', () => {
    const result = decide('Müşteri alanı yanlış geliyor, düzeltelim');
    expect(result.caseType).toBe('SUPPORT');
    expect(result.action).toBe('ASK');
    expect(result.documentRequested).toBe(false);
    expect(result.questions.length).toBeLessThanOrEqual(3);
  });

  it('keeps a small CRM field defect in support scope', () => {
    const result = decide('CRM müşteri alanı yanlış geliyor; beklenen değer vergi numarası olmalı');
    expect(result.caseType).toBe('SUPPORT');
    expect(result.documentRequested).toBe(false);
  });

  it('never treats topic words alone as permission to create a document', () => {
    const result = decide('Yeni ekranda fonksiyonel gereksinimler ve süreç akışı konuşalım');
    expect(result.documentRequested).toBe(false);
    expect(['ANSWER', 'ASK']).toContain(result.action);
  });

  it('asks before a sparse explicit document request', () => {
    const result = decide('Yeni bir iş analizi dokümanı oluştur');
    expect(result.documentRequested).toBe(true);
    expect(result.action).toBe('ASK');
  });

  it('creates an explicit document when source knowledge is present', () => {
    const result = decide('Bu bilgilerden iş analizi dokümanı oluştur', { knowledgeItemCount: 3 });
    expect(result.action).toBe('CREATE_ARTIFACT');
  });

  it('creates immediately when the user explicitly allows assumptions', () => {
    const result = decide('Varsayımlarla iş analizi dokümanı oluştur');
    expect(result.action).toBe('CREATE_ARTIFACT');
    expect(result.allowAssumptions).toBe(true);
  });

  it('reviews an existing document read-only', () => {
    const result = decide('Mevcut analizimin olgunluk seviyesini değerlendir ve eksikleri bul', {
      hasDocument: true,
    });
    expect(result.action).toBe('REVIEW_ARTIFACT');
    expect(result.documentRequested).toBe(false);
  });

  it('updates only with an explicit update request', () => {
    const result = decide('Dokümandaki iş kuralları bölümünü güncelle', {
      hasDocument: true,
    });
    expect(result.action).toBe('UPDATE_ARTIFACT');
  });

  it('recognizes BPMN generation as an explicit flow artifact request', () => {
    const result = decide('Bu bilgilerle BPMN XML oluştur', { knowledgeItemCount: 1 });
    expect(result.action).toBe('CREATE_ARTIFACT');
    expect(result.focus).toBe('flow');
  });

  it('continues an explicit document request after the user answers maturation questions', () => {
    const result = decideSimpleBaTurn({
      userMessage: 'Amaç teklif hatalarını azaltmak. Bayi ve satış rolleri CRM kullanacak.',
      hasDocument: false,
      recentMessages: [
        { role: 'user', text: 'Yeni bir iş analizi dokümanı oluştur' },
        {
          role: 'model',
          text: 'Talebi doğru çerçevelemek için şu noktaları netleştirelim.',
          questions: [{ id: 'q1', text: 'Amaç nedir?', options: [] }],
        },
      ],
    });
    expect(result.action).toBe('CREATE_ARTIFACT');
    expect(result.reasonCode).toBe('maturation_answers_received');
  });
});
