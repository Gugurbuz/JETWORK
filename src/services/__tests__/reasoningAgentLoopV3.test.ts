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

  it('keeps the semantic failure path conservative and evidence-first', async () => {
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
    expect(result.plan.intent).toBe('sap_diagnosis');
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.verificationRequired).toBe(true);
    expect(result.plan.evidenceQueries.length).toBeGreaterThan(0);
    expect(result.plan.orchestratorVersion).toContain('safe-fallback');
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
