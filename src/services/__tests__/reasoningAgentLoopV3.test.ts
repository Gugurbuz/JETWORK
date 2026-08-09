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
  webMode: 'none',
  verificationRequired: true,
  creativeMode: false,
  evidenceQueries: ['cost uyumsuz hata', 'ZCRM_COST uyumsuz'],
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
  },
  orchestratorVersion: 'test',
  ...overrides,
});

describe('Reasoning Engine v3 adaptive agent loop', () => {
  it('turns knowledge plans into model-driven observe-decide-act loops instead of deterministic preflight searches', () => {
    const result = applyAgentLoopPolicy(plan(), 'openai');

    expect(result.knowledgeRequired).toBe(true);
    expect(result.evidenceQueries).toEqual([]);
    expect(result.verificationRequired).toBe(false);
    expect(result.steps.map(step => step.id)).toEqual(['adaptive-evidence-loop', 'synthesize']);
    expect(result.goal).toContain('[JETWORK_AGENT_LOOP]');
    expect(result.goal).toContain('sonucu gözlemle');
    expect(result.goal).toContain('sorguyu yeniden formüle et');
    expect(result.goal).toContain('reddettiği hipotezi');
    expect(result.goal).toContain('Vade uyumsuzluğu');
    expect(result.orchestratorVersion).toBe(SEMANTIC_ORCHESTRATOR_VERSION);
  });

  it('keeps optional OpenAI web capability available without forcing a deterministic web preflight', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'if_internal_insufficient',
      verificationRequired: true,
    }), 'openai');

    expect(result.webMode).toBe('if_internal_insufficient');
    expect(result.knowledgeRequired).toBe(false);
    expect(result.evidenceQueries).toEqual([]);
    expect(result.verificationRequired).toBe(false);
    expect(result.steps[0]?.toolHint).toBe('web');
  });

  it('keeps required OpenAI web research model-driven instead of triggering legacy deterministic preflight', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'required',
      verificationRequired: true,
    }), 'openai');

    expect(result.webMode).toBe('if_internal_insufficient');
    expect(result.goal).toContain('nihai yanıttan önce izin verilen web aracını kullan');
    expect(result.evidenceQueries).toEqual([]);
    expect(result.verificationRequired).toBe(false);
  });

  it('maps Gemini web intent to provider-native Google Search without exposing the OpenAI web path', () => {
    const result = applyAgentLoopPolicy(plan({
      intent: 'research',
      executionMode: 'research',
      knowledgeRequired: false,
      webMode: 'required',
    }), 'gemini');

    expect(result.webMode).toBe('none');
    expect(result.knowledgeRequired).toBe(true);
    expect(result.evidenceQueries).toEqual([]);
    expect(result.verificationRequired).toBe(false);
    expect(result.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER);
    expect(result.goal).toContain('native Google Search');
    expect(result.goal).toContain('OpenAI web aracına geçme');
  });

  it('keeps semantic-provider failure agentic and remembers a rejected diagnosis', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Hayır vade değildi, başka bir şey yazıyordu.',
      conversation: [
        { role: 'user', content: 'Teklife Cost eklerken uyumsuzluk hatası alıyorum.' },
        { role: 'assistant', content: 'Vade uyumsuzluğu olabilir.' },
      ],
      priorExecution: {
        intent: 'sap_diagnosis',
        complexity: 'medium',
        knowledgeUsed: true,
      },
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe('missing-api-key');
    expect(result.model).toBe('gemini-3-flash-preview');
    expect(result.plan.intent).toBe('sap_diagnosis');
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.verificationRequired).toBe(false);
    expect(result.plan.evidenceQueries).toEqual([]);
    expect(result.plan.steps.map(step => step.id)).toEqual(['adaptive-evidence-loop', 'synthesize']);
    expect(result.plan.conversationState?.userMove).toBe('rejection');
    expect(result.plan.conversationState?.rejectedHypotheses.join(' ')).toContain('Vade uyumsuzluğu');
    expect(result.plan.goal).toContain('[JETWORK_AGENT_LOOP]');
    expect(result.plan.orchestratorVersion).toContain('safe-fallback-missing-api-key');
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

  it('accumulates multiple rejected hypotheses across a technical investigation when semantic planning is unavailable', async () => {
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
    expect(result.plan.goal).toContain('Yeni ve açık kanıt olmadan bunları tekrar aday gibi sunma');
  });

  it('uses the current Gemini structured-output contract and resilient same-provider retries', () => {
    const semanticSource = readFileSync(
      new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
      'utf8',
    );
    const providerSource = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(semanticSource).toContain("const GEMINI_SEMANTIC_MODEL = 'gemini-3-flash-preview'");
    expect(semanticSource).toContain('responseFormat: {');
    expect(semanticSource).toContain("mimeType: 'application/json'");
    expect(semanticSource).not.toContain("responseMimeType: 'application/json'");
    expect(semanticSource).toContain('withSemanticRetry');
    expect(providerSource).toContain('GEMINI_RETRY_DELAYS_MS');
    expect(providerSource).toContain('isRetryableGeminiError');
    expect(providerSource).toContain('generateGeminiContentWithResilience');
    expect(providerSource).toContain('GEMINI_PRO_CIRCUIT_BREAKER_MS');
    expect(providerSource).toContain('GEMINI_ATTEMPT_TIMEOUT_MS');
    expect(providerSource).toContain('generateGeminiAttempt');
    expect(providerSource).toContain('same-provider Flash fallback');
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