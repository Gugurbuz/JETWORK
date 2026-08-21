import { describe, expect, it } from 'vitest';
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator';

describe('enterprise knowledge discovery regression', () => {
  it('runs opportunistic knowledge discovery for a natural-language enterprise question without forcing grounding', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Ninja hesaplamadındaki hata kodları neler',
      conversation: [],
      priorExecution: {
        intent: 'simple_answer',
        complexity: 'low',
        knowledgeUsed: false,
      },
    });

    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
    expect(result.plan.executionMode).toBe('knowledge');
    expect(result.plan.evidenceQueries.length).toBeGreaterThan(0);
    expect(result.plan.evidenceQueries.join(' ')).toContain('Ninja hesaplamadındaki hata kodları');
    expect(result.plan.goal).toContain('JETWORK_KNOWLEDGE_DISCOVERY');
  });

  it('resolves Hepsi against the last meaningful request and keeps discovery active when the previous turn found no knowledge', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Hepsi',
      conversation: [
        { role: 'user', content: 'Ninja hesaplamadındaki hata kodları' },
        { role: 'assistant', content: 'Hangi hata kodunu incelemek istiyorsunuz?' },
      ],
      priorExecution: {
        intent: 'simple_answer',
        complexity: 'low',
        knowledgeUsed: false,
        resolvedRequest: 'Hepsi',
      },
    });

    expect(result.plan.conversationState?.continuation).toBe(true);
    expect(result.plan.conversationState?.userMove).toBe('follow_up');
    expect(result.plan.conversationState?.resolvedRequest).toContain('Ninja hesaplamadındaki hata kodları');
    expect(result.plan.conversationState?.resolvedRequest).toContain('Hepsi');
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
    expect(result.plan.evidenceQueries.join(' ')).toContain('Ninja hesaplamadındaki hata kodları');
  });

  it('discovers internal knowledge for a non-technical business-process question when a source may exist', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Satış süreci nasıl işliyor?',
      conversation: [],
      priorExecution: {
        intent: 'simple_answer',
        complexity: 'low',
        knowledgeUsed: false,
      },
    });

    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
    expect(result.plan.evidenceQueries.length).toBeGreaterThan(0);
  });

  it('does not turn casual chat into a knowledge lookup', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Nasıl gidiyor?',
      conversation: [],
      priorExecution: {
        intent: 'simple_answer',
        complexity: 'low',
        knowledgeUsed: false,
      },
    });

    expect(result.plan.knowledgeRequired).toBe(false);
    expect(result.plan.evidenceQueries).toEqual([]);
    expect(result.plan.goal).not.toContain('JETWORK_KNOWLEDGE_DISCOVERY');
  });

  it('does not repeat preflight discovery for a continuation when the previous turn already used knowledge', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'tam kod ver',
      conversation: [
        { role: 'user', content: 'ZCRM2-545 hangi koşulda alınır?' },
        { role: 'assistant', content: 'Kurumsal kaynak kullanıldı.' },
      ],
      priorExecution: {
        intent: 'analysis',
        complexity: 'medium',
        knowledgeUsed: true,
      },
    });

    expect(result.plan.conversationState?.continuation).toBe(true);
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.evidenceQueries).toEqual([]);
  });
});
