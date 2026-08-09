import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent';
import {
  buildReasoningPlan,
  routeReasoningRequest,
  routingSurfaceFromMessage,
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
} from '../../../supabase/functions/_shared/reasoningEngine';

const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
);
const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);
const reasoningSource = readFileSync(
  new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url),
  'utf8',
);
const orchestratorSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../../store/useSettingsStore.ts', import.meta.url),
  'utf8',
);

const existingDocument = {
  businessAnalysis: {
    content: '<h1>İHTİYAÇ ANALİZİ</h1><p>Mevcut doküman.</p>',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: '',
    status: 'DRAFT',
    flags: [],
  },
} as DocumentData;

const semanticFollowUp = (current: string) => {
  const plan = {
    intent: 'sap_diagnosis',
    complexity: 'medium',
    executionMode: 'knowledge',
    goal: 'Cost ekleme sırasında alınan uyumsuzluk hatasının vade dışındaki adaylarını doğrula.',
    knowledgeRequired: true,
    webMode: 'none',
    verificationRequired: true,
    creativeMode: false,
    evidenceQueries: ['cost uyumsuz hata', 'ZCRM_COST uyumsuz'],
    steps: [
      { id: 'knowledge', label: 'Kurumsal hata kayıtlarını ara', toolHint: 'knowledge', successCriteria: 'Alternatif exact mesaj kayıtları bulunur.' },
      { id: 'verify', label: 'Adayları doğrula', toolHint: 'verification', successCriteria: 'Vade hipotezi dışındaki kanıtlar ayrılır.' },
      { id: 'synthesize', label: 'Yanıtı üret', toolHint: 'synthesis', successCriteria: 'Kanıtsız kategori uydurulmaz.' },
    ],
    conversationState: {
      continuation: true,
      topic: 'Teklife cost eklerken uyumsuzluk hatası',
      userMove: 'rejection',
      priorIntent: 'sap_diagnosis',
      rejectedHypotheses: ['ZCRM_COST-112 vade günü uyumsuzluğu'],
      retainedContext: ['Kullanıcı hata metninde uyumsuz kelimesini hatırlıyor.'],
      openQuestions: ['Exact mesaj kodu bilinmiyor.'],
    },
    orchestratorVersion: 'semantic-orchestrator-v1',
  };
  return [current, '', SEMANTIC_PLAN_START, JSON.stringify(plan), SEMANTIC_PLAN_END].join('\n');
};

describe('provider, evidence and semantic intent integrity', () => {
  it('does not treat Turkish inflections as document edit commands', () => {
    expect(resolveAssistantDocumentRequestMode(
      'Teklife cost eklerken aldım hatayı',
      existingDocument,
    )).toBe('none');
  });

  it('keeps the legacy compatibility router safe for standalone technical diagnosis', () => {
    expect(routeReasoningRequest('Teklif kaydederken uyumsuz hatası alıyorum')).toMatchObject({
      intent: 'sap_diagnosis',
      knowledgeRequired: true,
      verificationRequired: true,
      webMode: 'none',
    });
  });

  it('uses the AI semantic plan for natural follow-ups that repeat no technical keywords', async () => {
    const message = semanticFollowUp('Hayır vade yazmadığına eminim başka bir şey yazıyordu');
    const route = routeReasoningRequest(message);

    expect(route).toMatchObject({
      intent: 'sap_diagnosis',
      complexity: 'medium',
      knowledgeRequired: true,
      verificationRequired: true,
      webMode: 'none',
    });
    expect(routingSurfaceFromMessage(message).current).toBe(
      'Hayır vade yazmadığına eminim başka bir şey yazıyordu',
    );

    const planned = await buildReasoningPlan({
      model: 'gemini-3.1-pro-preview',
      message,
      route,
    });
    expect(planned.plannerFallback).toBe(false);
    expect(planned.plan.conversationState).toMatchObject({
      continuation: true,
      userMove: 'rejection',
      priorIntent: 'sap_diagnosis',
    });
    expect(planned.plan.evidenceQueries).toContain('cost uyumsuz hata');
  });

  it('keeps generated document/template text out of routing surface', () => {
    const expandedMessage = [
      'Kurumsal yapıda kavramsal tasarım dokümanı hazırla.',
      '',
      '[Sistem yönlendirmesi: Kullanıcı açıkça düzenlenebilir bir Enerjisa ihtiyaç analizi dokümanı istiyor.]',
      'Mevcut dokümanda güncel fiyat ve bugün ifadeleri bulunuyor.',
    ].join('\n');

    expect(routingSurfaceFromMessage(expandedMessage).current).toBe(
      'Kurumsal yapıda kavramsal tasarım dokümanı hazırla.',
    );
  });

  it('makes semantic orchestration the primary substantive decision layer', () => {
    expect(gatewaySource).toContain('buildSemanticExecutionPlan');
    expect(gatewaySource).toContain('loadSemanticContext');
    expect(gatewaySource).toContain('ASSISTANT_SEMANTIC_ORCHESTRATION');
    expect(gatewaySource).not.toContain('AMBIGUOUS_FOLLOW_UP_PATTERN');
    expect(gatewaySource).not.toContain('previousSubstantiveUserMessage');
    expect(orchestratorSource).toContain('currentUserMessage');
    expect(orchestratorSource).toContain('recentConversation');
    expect(orchestratorSource).toContain('Natural conversation continuity is semantic');
    expect(reasoningSource).toContain('semanticPlanFromMessage');
    expect(reasoningSource).toContain('if (semanticPlan) return { plan: semanticPlan, plannerFallback: false }');
  });

  it('enforces provider isolation after semantic web intent instead of keyword routing', () => {
    expect(gatewaySource).toContain("semantic.plan.webMode === 'required'");
    expect(gatewaySource).toContain('GEMINI_PROVIDER_LOCK_WEB_UNAVAILABLE');
    expect(gatewaySource).not.toContain('EXPLICIT_WEB_PATTERN');
  });

  it('does not expose the internal semantic plan to the final answer model', () => {
    expect(providerSource).toContain('stripInternalSemanticPlan');
    expect(providerSource).toContain('INTERNAL_SEMANTIC_PLAN_PATTERN');
    expect(providerSource).toContain("if ('content' in clean) clean.content = sanitizeContent(clean.content)");
  });

  it('promotes substantive Flash Lite execution to Gemini Pro while leaving exact trivial fast path separate', () => {
    expect(providerSource).toContain("GEMINI_SUBSTANTIVE_MODEL");
    expect(gatewaySource).toContain('substantiveModel(requestedModel)');
    expect(settingsSource).toContain('normalizeSelectableModel');
    expect(settingsSource).toContain('model === FLASH_LITE_MODEL ? GEMINI_PRO_MODEL');
  });

  it('requires exact evidence for exact Gemini SAP/CRM identifiers', () => {
    const legacyProviderSource = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );
    expect(legacyProviderSource).toContain('[JETWORK KANIT BÜTÜNLÜĞÜ - ZORUNLU]');
    expect(legacyProviderSource).toContain('yakın kodlar veya benzer SAP süreçleri o kimlik için kanıt değildir');
    expect(legacyProviderSource).toContain('class, method, mesaj metni, tetikleyici veya çözüm uydurma');
  });
});
