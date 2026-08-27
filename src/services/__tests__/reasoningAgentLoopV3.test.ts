import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';
import {
  applyAgentLoopPolicy,
  buildSemanticExecutionPlan,
  PROVIDER_WEB_CAPABILITY_MARKER,
  SEMANTIC_ORCHESTRATOR_VERSION,
} from '../../../supabase/functions/_shared/semanticOrchestrator';

const plan = (overrides: Partial<ReasoningPlan> = {}): ReasoningPlan => ({
  intent: 'sap_diagnosis',
  complexity: 'medium',
  executionMode: 'knowledge',
  goal: 'Cost ekleme hatasını kanıta dayalı biçimde teşhis et.',
  knowledgeRequired: true,
  enterpriseGroundingRequired: true,
  webMode: 'none',
  verificationRequired: true,
  creativeMode: false,
  evidenceQueries: ['cost uyumsuz hata', 'ZCRM_COST uyumsuz'],
  promptProfile: 'knowledge',
  steps: [
    { id: 'search', label: 'Ara', toolHint: 'knowledge', successCriteria: 'Kayıt bul.' },
    { id: 'verify', label: 'Doğrula', toolHint: 'verification', successCriteria: 'Kanıtı doğrula.' },
  ],
  conversationState: {
    continuation: true,
    topic: 'Cost ekleme hatası',
    userMove: 'rejection',
    priorIntent: 'sap_diagnosis',
    rejectedHypotheses: ['Vade uyumsuzluğu'],
    retainedContext: [],
    openQuestions: ['Exact mesaj kodu bilinmiyor'],
    resolvedRequest: 'Cost ekleme hatasını kanıta dayalı biçimde teşhis et.',
    activeEntities: ['ZCRM_COST'],
    requestedEvidence: ['trigger_rule'],
    userDecisions: [],
    verifiedFactRefs: [],
  },
  orchestratorVersion: 'legacy-test',
  ...overrides,
});

describe('Reasoning primary-agent and legacy capability compatibility', () => {
  it('keeps legacy explicit plans compact instead of injecting policy into the goal', () => {
    const result = applyAgentLoopPolicy(plan(), 'openai');

    expect(result.knowledgeRequired).toBe(true);
    expect(result.goal).toBe('Cost ekleme hatasını kanıta dayalı biçimde teşhis et.');
    expect(result.goal).not.toContain('[JETWORK_AGENT_LOOP]');
    expect(result.steps.map(step => step.id)).toEqual(['adaptive-evidence-loop', 'synthesize']);
    expect(result.orchestratorVersion).toBe(SEMANTIC_ORCHESTRATOR_VERSION);
  });

  it('keeps legacy optional OpenAI web capability available without mixing policy into the goal', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      enterpriseGroundingRequired: false,
      webMode: 'if_internal_insufficient',
      verificationRequired: false,
      promptProfile: 'research',
    }), 'openai');

    expect(result.webMode).toBe('if_internal_insufficient');
    expect(result.knowledgeRequired).toBe(false);
    expect(result.steps[0]?.toolHint).toBe('web');
    expect(result.goal).not.toContain('JETWORK_AGENT_LOOP');
  });

  it('keeps legacy provider-native Gemini web mapping available for explicit old plans', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      enterpriseGroundingRequired: false,
      webMode: 'required',
      verificationRequired: false,
      promptProfile: 'research',
    }), 'gemini');

    expect(result.webMode).toBe('none');
    expect(result.knowledgeRequired).toBe(true);
    expect(result.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER);
  });

  it('resolves an elliptical technical follow-up without a semantic provider call', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'tam kod ver',
      conversation: [
        { role: 'user', content: 'ZCRM2-545 hangi koşulda alınır?' },
        { role: 'assistant', content: 'Önceki cevabın metni kanıt değildir.' },
      ],
      priorExecution: {
        intent: 'analysis',
        complexity: 'medium',
        knowledgeUsed: true,
      },
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.model).toBe('gemini-3.1-pro-preview');
    expect(result.usage?.semantic_planner_provider_calls_avoided).toBe(1);
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
    expect(result.plan.evidenceQueries).toEqual([]);
    expect(result.plan.conversationState?.continuation).toBe(true);
    expect(result.plan.conversationState?.activeEntities).toContain('ZCRM2-545');
    expect(result.plan.conversationState?.requestedEvidence).toContain('abap_source');
    expect(result.plan.conversationState?.resolvedRequest).toContain('ZCRM2-545');
    expect(result.plan.goal).toContain('ZCRM2-545');
  });

  it('remembers rejected assistant hypotheses only as rejected conversational context, never verified facts', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Hayır paçal da yazmıyordu.',
      conversation: [
        { role: 'user', content: 'Teklife Cost eklerken uyumsuzluk hatası alıyorum.' },
        { role: 'assistant', content: 'Vade uyumsuzluğu olabilir.' },
        { role: 'user', content: 'Hayır vade hatası değildi.' },
        { role: 'assistant', content: 'Uyumsuz paçal offer id hatası olabilir.' },
      ],
      priorExecution: {
        intent: 'sap_diagnosis',
        complexity: 'medium',
        knowledgeUsed: true,
      },
    });

    const rejected = result.plan.conversationState?.rejectedHypotheses.join(' ') || '';
    expect(rejected).toContain('Vade uyumsuzluğu');
    expect(rejected).toContain('paçal offer id');
    expect(result.plan.conversationState?.verifiedFactRefs).toEqual([]);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
  });

  it('does not let a previous trivial greeting downgrade a new technical diagnosis', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Teklife kost eklerken bir hata aldım ama hata mesajını ya da kodunu yakalayamadım sadece yakalayabildi kelime uyumsuz yazıyordu',
      conversation: [
        { role: 'user', content: 'Selam' },
        { role: 'assistant', content: 'Selam! Sana nasıl yardımcı olabilirim?' },
      ],
      priorExecution: {
        intent: 'simple_answer',
        complexity: 'low',
        knowledgeUsed: false,
      },
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.plan.intent).toBe('sap_diagnosis');
    expect(result.plan.conversationState?.continuation).toBe(false);
    expect(result.plan.conversationState?.priorIntent).toBe('none');
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.evidenceQueries).toEqual([]);
  });

  it('treats a long supplied requirement as self-contained evidence without adding a planner call', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      message: [
        'analiz dokümanı yaz',
        '1.1 LÜ Proforma LRT-V3P kapsamında yeni süreç tasarlanacaktır.',
        '1.2 Faturalama detayları örnek Excel içinde paylaşılmıştır.',
        '1.3 Sanal borç kalemlerinin oluşturulması ve mahsuplaşma kuralları açıklanmalıdır.',
        '2.1 Gereksinimler mevcut süreç ve iş kuralları dikkate alınarak analiz edilmelidir.',
        '2.2 Açık konular analiz dokümanında ayrıca gösterilmelidir.',
      ].join('\n').repeat(6),
      conversation: [],
    })

    expect(result.plan.intent).toBe('analysis')
    expect(result.plan.executionMode).toBe('direct')
    expect(result.plan.knowledgeRequired).toBe(false)
    expect(result.plan.webMode).toBe('none')
    expect(result.usage?.semantic_planner_provider_calls_avoided).toBe(1)
  })

  it('removes the semantic provider request stack and records avoided planner calls', () => {
    const semanticSource = readFileSync(
      new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
      'utf8',
    );
    expect(SEMANTIC_ORCHESTRATOR_VERSION).toBe('primary-llm-agent-v1');
    expect(semanticSource).toContain('semantic_planner_provider_calls_avoided');
    expect(semanticSource).not.toContain('requestGeminiPlanOnce');
    expect(semanticSource).not.toContain('requestOpenAiPlan');
    expect(semanticSource).not.toContain('withSemanticRetry');
    expect(semanticSource).not.toContain('responseMimeType');
  });

  it('keeps Gemini native Google Search plus custom function calling available to the primary model', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('googleSearch: {}');
    expect(source).toContain('includeServerSideToolInvocations: true');
    expect(source).toContain("providerWebEnabled ? 'VALIDATED' : 'AUTO'");
    expect(source).toContain('_geminiSkipContent');
    expect(source).toContain('appendGroundingSources');
  });
});
