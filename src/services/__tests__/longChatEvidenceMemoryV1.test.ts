import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandKnowledgeSearchQueries } from '../../../supabase/functions/_shared/assistantTools';
import { composeAssistantPrompt } from '../../../supabase/functions/_shared/assistantPromptProfiles';
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';

const activePromptFixture = [
  'BASE CHAT CONTRACT',
  '[ENERJİSA İHTİYAÇ ANALİZİ DOKÜMAN SÖZLEŞMESİ - ZORUNLU]',
  'DOCUMENT CONTRACT',
  '[JETWORK SUNUM METADATA SÖZLEŞMESİ - ZORUNLU]',
  'PRESENTATION CONTRACT',
  '[JETWORK PRODUCT QUALITY CONTRACT v1]',
  'QUALITY CONTRACT',
  '[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]',
  'EXACT EVIDENCE CONTRACT',
  '[JETWORK REASONING ENGINE V2 - OPERATIONAL CONTEXT]',
  'RUNTIME CONTEXT',
].join('\n');

const knowledgePlan: ReasoningPlan = {
  intent: 'analysis',
  complexity: 'medium',
  executionMode: 'knowledge',
  promptProfile: 'knowledge',
  goal: 'ZCRM_COST-123 exact message text',
  knowledgeRequired: true,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  conversationState: {
    continuation: true,
    topic: 'ZCRM_COST-123',
    userMove: 'follow_up',
    priorIntent: 'analysis',
    rejectedHypotheses: [],
    retainedContext: [],
    openQuestions: [],
    resolvedRequest: 'ZCRM_COST-123 için doğrulanmış exact hata mesajı metnini getir',
    activeEntities: ['ZCRM_COST-123'],
    requestedEvidence: ['message_text'],
    userDecisions: [],
    verifiedFactRefs: ['message:zcrm_cost-123'],
  },
};

const normalizeAnchor = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

describe('long-chat context/evidence memory v1', () => {
  it('never drops an IYS identifier anchor while expanding a mixed enterprise query', () => {
    const variants = expandKnowledgeSearchQueries('IYS entegrasyonu');
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      expect(normalizeAnchor(variant).split(/\s+/)).toContain('iys');
    }
    expect(variants).not.toContain('entegrasyonu');
  });

  it('keeps normal knowledge prompts free of document/presentation/artifact contracts', () => {
    const prompt = composeAssistantPrompt(activePromptFixture, knowledgePlan);
    expect(prompt).toContain('BASE CHAT CONTRACT');
    expect(prompt).toContain('EXACT EVIDENCE CONTRACT');
    expect(prompt).toContain('RUNTIME CONTEXT');
    expect(prompt).not.toContain('DOCUMENT CONTRACT');
    expect(prompt).not.toContain('PRESENTATION CONTRACT');
    expect(prompt).not.toContain('QUALITY CONTRACT');
  });

  it('keeps all artifact contracts for document generation', () => {
    const prompt = composeAssistantPrompt(activePromptFixture, {
      ...knowledgePlan,
      intent: 'document',
      executionMode: 'artifact',
      promptProfile: 'artifact',
    });
    expect(prompt).toContain('DOCUMENT CONTRACT');
    expect(prompt).toContain('PRESENTATION CONTRACT');
    expect(prompt).toContain('QUALITY CONTRACT');
    expect(prompt).toContain('EXACT EVIDENCE CONTRACT');
  });

  it('resolves exact-message follow-up to the active message entity without trusting assistant prose', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'hata mesajı nedir',
      conversation: [
        { role: 'user', content: 'zcrmcost 123 ü ver o zaman' },
        { role: 'assistant', content: 'Benim önceki paraphrase cevabım exact message kanıtı değildir.' },
      ],
      priorExecution: {
        intent: 'analysis',
        complexity: 'medium',
        knowledgeUsed: true,
        activeEntities: ['ZCRM_COST-123'],
        verifiedFactRefs: ['message:zcrm_cost-123'],
      },
    });

    expect(result.plan.conversationState?.resolvedRequest).toContain('ZCRM_COST-123');
    expect(result.plan.conversationState?.requestedEvidence).toContain('message_text');
    expect(result.plan.conversationState?.verifiedFactRefs).toContain('message:zcrm_cost-123');
    expect(result.plan.goal).toContain('ZCRM_COST-123');
    expect(result.plan.goal).not.toContain('önceki paraphrase');
  });

  it('keeps semantic search candidates out of citation-ready sources until detail verification', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('sources: []');
    expect(source).toContain('citationReady: false');
    expect(source).toContain('candidateSourceCount');
    expect(source).toContain('citationReady: true');
  });

  it('persists verified memory only from exact/detail tools, never semantic search', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20260811004500_verified_fact_memory.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain("new.tool_name not in ('get_message_detail','get_abap_source','get_document_content','get_knowledge_object')");
    expect(migration).not.toContain("'search_knowledge_catalog','get_message_detail'");
    expect(migration).toContain('assistant_verified_facts');
  });
});