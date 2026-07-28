import { describe, expect, it, vi } from 'vitest';
import type { DocumentData, KnowledgeItem, Message } from '../../types';
import {
  buildAnalystTurnContext,
  prepareConversation,
  renderAnalystTurnContext,
  selectRelevantProjectFacts,
  toModelHistory,
} from '../analystContext';

const message = (
  id: string,
  role: Message['role'],
  text: string,
  overrides: Partial<Message> = {},
): Message => ({
  id,
  role,
  text,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
  ...overrides,
});

describe('analystContext', () => {
  it('excludes the current user turn, empty typing records and adjacent duplicates', () => {
    const prepared = prepareConversation([
      message('m1', 'user', 'Önceki karar'),
      message('m2', 'model', 'Anladım'),
      message('m3', 'user', 'Yeni talep'),
      message('m4', 'user', 'Yeni talep'),
      message('typing', 'model', '', { isTyping: true }),
    ], {
      currentUserMessageId: 'm3',
      tokenBudget: 6_000,
    });

    expect(prepared.recentConversation.map(item => item.id)).toEqual(['m1', 'm2', 'm4']);
    expect(prepared.excludedMessageIds).toEqual(expect.arrayContaining(['m3', 'typing']));
  });

  it('normalizes consecutive roles before sending model history', () => {
    const history = toModelHistory([
      message('m1', 'user', 'Birinci bilgi', { senderName: 'Gürkan' }),
      message('m2', 'user', 'İkinci bilgi', { senderName: 'Gürkan' }),
      message('m3', 'model', 'Yanıt'),
    ]);

    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].parts[0].text).toContain('Birinci bilgi');
    expect(history[0].parts[0].text).toContain('İkinci bilgi');
    expect(history[1].role).toBe('model');
  });

  it('awaits the old-conversation summary and renders one canonical context', async () => {
    const summarize = vi.fn(async () => 'Karar: müşteri tipi CRM tarafından belirlenir.');
    const artifact: DocumentData = {
      businessAnalysis: { content: '# Mevcut Analiz', status: 'DRAFT', flags: [] },
    };
    const knowledge: KnowledgeItem[] = [{
      id: 'k1',
      content: 'SAP CRM müşteri tipi iş kuralı',
      keywords: ['crm'],
      importance: 9,
      createdAt: 1,
      projectId: 'w1',
    }];
    const messages = Array.from({ length: 10 }, (_, index) => (
      message(`m${index}`, index % 2 ? 'model' : 'user', `Uzun geçmiş mesajı ${index} ${'x'.repeat(500)}`)
    ));

    const context = await buildAnalystTurnContext({
      userMessage: 'CRM iş kuralını güncelle',
      messages,
      projectMemory: { 'decision.customer_type': 'CRM belirler' },
      knowledgeBase: knowledge,
      currentArtifact: artifact,
      tokenBudget: 800,
      summarize,
    });
    const rendered = renderAnalystTurnContext(context);

    expect(summarize).toHaveBeenCalledOnce();
    expect(context.conversationSummary).toContain('müşteri tipi');
    expect(context.retrievedSources.map(item => item.id)).toEqual(['k1']);
    expect(rendered).toContain('[CANONICAL PROJECT CONTEXT]');
    expect(rendered).toContain('[CONVERSATION SUMMARY]');
    expect(rendered).toContain('[CURRENT LIVING ARTIFACT]');
    expect(rendered).toContain('# Mevcut Analiz');
  });

  it('awaits configured semantic retrieval before returning the turn context', async () => {
    const retrieveKnowledge = vi.fn(async () => [{
      id: 'semantic-1',
      content: 'Müşteri tipi yalnız CRM tarafından belirlenir.',
      keywords: ['müşteri', 'crm'],
      importance: 10,
      createdAt: 1,
      projectId: 'w1',
    }]);

    const context = await buildAnalystTurnContext({
      userMessage: 'Müşteri tipi kuralı nedir?',
      messages: [],
      knowledgeBase: [],
      currentArtifact: null,
      summarize: async () => '',
      retrieveKnowledge,
    });

    expect(retrieveKnowledge).toHaveBeenCalledOnce();
    expect(context.retrievedSources.map(item => item.id)).toEqual(['semantic-1']);
  });

  it('selects only memory items relevant to the current turn', () => {
    const facts = [
      {
        id: 'crm',
        key: 'decision.customer_type',
        type: 'DECISION' as const,
        value: 'Müşteri tipini yalnız CRM belirler.',
        sourceType: 'USER' as const,
        sourceId: 'm1',
        confirmationStatus: 'CONFIRMED' as const,
        confidence: 1,
        validFrom: '2026-07-24T10:00:00.000Z',
      },
      {
        id: 'payment',
        key: 'decision.payment_retry',
        type: 'DECISION' as const,
        value: 'Ödeme üç kez yeniden denenir.',
        sourceType: 'USER' as const,
        sourceId: 'm2',
        confirmationStatus: 'CONFIRMED' as const,
        confidence: 1,
        validFrom: '2026-07-25T10:00:00.000Z',
      },
    ];

    expect(selectRelevantProjectFacts('CRM müşteri tipi kuralını güncelle', facts))
      .toEqual([facts[0]]);
  });
});
