import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';
import { GEMINI_SEMANTIC_MODEL } from '../../../supabase/functions/_shared/geminiCostGuard';
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
  orchestratorVersion: 'test',
  ...overrides,
});

describe('Reasoning Engine v3 resolved-context capability policy', () => {
  it('keeps the user goal compact instead of injecting agent-loop policy into it', () => {
    const result = applyAgentLoopPolicy(plan(), 'openai');

    expect(result.knowledgeRequired).toBe(true);
    expect(result.goal).toBe('Cost ekleme hatasını kanıta dayalı biçimde teşhis et.');
    expect(result.goal).not.toContain('[JETWORK_AGENT_LOOP]');
    expect(result.steps.map(step => step.id)).toEqual(['adaptive-evidence-loop', 'synthesize']);
    expect(result.steps[0]?.successCriteria).toContain('zayıf adaylar citation sayılmaz');
    expect(result.orchestratorVersion).toBe(SEMANTIC_ORCHESTRATOR_VERSION);
  });

  it('keeps optional OpenAI web capability available without mixing policy into the goal', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'if_internal_insufficient',
      verificationRequired: true,
      promptProfile: 'research',
    }), 'openai');

    expect(result.webMode).toBe('if_internal_insufficient');
    expect(result.knowledgeRequired).toBe(false);
    expect(result.steps[0]?.toolHint).toBe('web');
    expect(result.goal).not.toContain('JETWORK_AGENT_LOOP');
  });

  it('maps required OpenAI web research to the conditional native capability contract', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'required',
      promptProfile: 'research',
    }), 'openai');

    expect(result.webMode).toBe('if_internal_insufficient');
    expect(result.steps[0]?.toolHint).toBe('web');
    expect(result.goal).not.toContain('izin verilen web aracını kullan');
  });

  it('maps Gemini web intent to provider-native Google Search marker only', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'required',
      promptProfile: 'research',
    }), 'gemini');

    expect(result.webMode).toBe('none');
    expect(result.knowledgeRequired).toBe(true);
    expect(result.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER);
    expect(result.goal).not.toContain('Araştırma sırasını önceden sabitleme');
  });

  it('resolves an elliptical technical follow-up into the prior user entity when the semantic provider is unavailable', async () => {
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

    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe('missing-api-key');
    expect(result.model).toBe(GEMINI_SEMANTIC_MODEL);
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.conversationState?.continuation).toBe(true);
    expect(result.plan.conversationState?.activeEntities).toContain('ZCRM2-545');
    expect(result.plan.conversationState?.requestedEvidence).toContain('abap_source');
    expect(result.plan.conversationState?.resolvedRequest).toContain('ZCRM2-545');
    expect(result.plan.goal).toContain('ZCRM2-545');
    expect(result.plan.goal).not.toContain('[JETWORK_AGENT_LOOP]');
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
    expect(result.plan.goal).not.toContain('Vade uyumsuzluğu');
  });

  it('does not let a previous trivial greeting downgrade a new technical diagnosis during fallback', async () => {
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

    expect(result.fallbackUsed).toBe(true);
    expect(result.plan.intent).toBe('sap_diagnosis');
    expect(result.plan.conversationState?.continuation).toBe(false);
    expect(result.plan.conversationState?.priorIntent).toBe('none');
    expect(result.plan.knowledgeRequired).toBe(true);
  });

  it('uses a stable Gemini semantic model and recovers schema-contract HTTP 400s with JSON compatibility mode', () => {
    const semanticSource = readFileSync(
      new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
      'utf8',
    );
    const providerSource = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(GEMINI_SEMANTIC_MODEL).toBe('gemini-3.1-flash-lite');
    expect(semanticSource).toContain("GEMINI_SEMANTIC_MODEL, usageWithGeminiEstimatedCost");
    expect(semanticSource).toContain("thinkingConfig: { thinkingLevel: 'minimal' }");
    expect(semanticSource).toContain('collectFallbackRejectedHypotheses');
    expect(semanticSource).toContain('resolvedRequest');
    expect(semanticSource).toContain('activeEntities');
    expect(semanticSource).toContain('responseFormat: {');
    expect(semanticSource).toContain("responseMimeType: 'application/json'");
    expect(semanticSource).toContain('compatibilityMode');
    expect(semanticSource).toContain('requestGeminiPlanOnce');
    expect(semanticSource).toContain('error.status !== 400');
    expect(semanticSource).toContain('withSemanticRetry');
    expect(providerSource).toContain('GEMINI_RETRY_DELAYS_MS');
    expect(providerSource).toContain('isRetryableGeminiError');
    expect(providerSource).toContain('generateGeminiContentWithResilience');
  });

  it('configures Gemini 3 for native Google Search plus custom function calling in the same adaptive loop', () => {
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