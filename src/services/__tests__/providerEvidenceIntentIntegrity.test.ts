import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DocumentData } from '../../types'
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent'
import {
  buildReasoningPlan,
  routeReasoningRequest,
  routingSurfaceFromMessage,
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
} from '../../../supabase/functions/_shared/reasoningEngine'
import { compactSemanticConversation } from '../../../supabase/functions/_shared/semanticOrchestrator'

const gatewaySource = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url), 'utf8')
const providerSource = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url), 'utf8')
const publicProviderSource = readFileSync(new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url), 'utf8')
const controllerPolicySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')
const reasoningSource = readFileSync(new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url), 'utf8')
const orchestratorSource = readFileSync(new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url), 'utf8')
const semanticCacheMigration = readFileSync(new URL('../../../supabase/migrations/20260809231500_semantic_orchestrator_plan_cache.sql', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../../store/useSettingsStore.ts', import.meta.url), 'utf8')

const existingDocument = {
  businessAnalysis: { content: '<h1>İHTİYAÇ ANALİZİ</h1><p>Mevcut doküman.</p>', status: 'DRAFT', flags: [] },
  review: { content: '', status: 'DRAFT', flags: [] },
} as DocumentData

const semanticFollowUp = (current: string) => {
  const plan = {
    intent: 'sap_diagnosis', complexity: 'medium', executionMode: 'knowledge',
    goal: 'Cost ekleme sırasında alınan uyumsuzluk hatasının vade dışındaki adaylarını doğrula.',
    knowledgeRequired: true, enterpriseGroundingRequired: true, webMode: 'none', verificationRequired: true, creativeMode: false,
    evidenceQueries: ['cost uyumsuz hata', 'ZCRM_COST uyumsuz'],
    steps: [
      { id: 'knowledge', label: 'Kurumsal hata kayıtlarını ara', toolHint: 'knowledge', successCriteria: 'Alternatif exact mesaj kayıtları bulunur.' },
      { id: 'verify', label: 'Adayları doğrula', toolHint: 'verification', successCriteria: 'Vade hipotezi dışındaki kanıtlar ayrılır.' },
      { id: 'synthesize', label: 'Yanıtı üret', toolHint: 'synthesis', successCriteria: 'Kanıtsız kategori uydurulmaz.' },
    ],
    conversationState: {
      continuation: true, topic: 'Teklife cost eklerken uyumsuzluk hatası', userMove: 'rejection', priorIntent: 'sap_diagnosis',
      rejectedHypotheses: ['ZCRM_COST-112 vade günü uyumsuzluğu'], retainedContext: ['Kullanıcı hata metninde uyumsuz kelimesini hatırlıyor.'], openQuestions: ['Exact mesaj kodu bilinmiyor.'],
    },
    orchestratorVersion: 'semantic-orchestrator-v1',
  }
  return [current, '', SEMANTIC_PLAN_START, JSON.stringify(plan), SEMANTIC_PLAN_END].join('\n')
}

describe('provider, evidence and semantic intent integrity', () => {
  it('does not treat Turkish inflections as document edit commands', () => {
    expect(resolveAssistantDocumentRequestMode('Teklife cost eklerken aldım hatayı', existingDocument)).toBe('none')
  })

  it('keeps the legacy compatibility router safe for standalone technical diagnosis', () => {
    expect(routeReasoningRequest('Teklif kaydederken uyumsuz hatası alıyorum')).toMatchObject({ intent: 'sap_diagnosis', knowledgeRequired: true, verificationRequired: true, webMode: 'none' })
  })

  it('keeps explicit embedded technical continuation metadata compatible with the core', async () => {
    const message = semanticFollowUp('Hayır vade yazmadığına eminim başka bir şey yazıyordu')
    const route = routeReasoningRequest(message)
    expect(route).toMatchObject({ intent: 'sap_diagnosis', complexity: 'medium', knowledgeRequired: true, verificationRequired: true, webMode: 'none' })
    expect(routingSurfaceFromMessage(message).current).toBe('Hayır vade yazmadığına eminim başka bir şey yazıyordu')
    const planned = await buildReasoningPlan({ model: 'gemini-3.1-pro-preview', message, route })
    expect(planned.plannerFallback).toBe(false)
    expect(planned.plan.conversationState).toMatchObject({ continuation: true, userMove: 'rejection', priorIntent: 'sap_diagnosis' })
    expect(planned.plan.evidenceQueries).toContain('cost uyumsuz hata')
  })

  it('prioritizes the newest conversation turns when context is bounded', () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? 'user' as const : 'assistant' as const, content: `${index}:${'x'.repeat(2_400)}` }))
    const compact = compactSemanticConversation(messages)
    expect(compact.at(-1)?.content.startsWith('9:')).toBe(true)
    expect(compact.some(item => item.content.startsWith('0:'))).toBe(false)
  })

  it('keeps generated document/template text out of routing surface', () => {
    const expandedMessage = ['Kurumsal yapıda kavramsal tasarım dokümanı hazırla.', '', '[Sistem yönlendirmesi: Kullanıcı açıkça düzenlenebilir bir Enerjisa ihtiyaç analizi dokümanı istiyor.]', 'Mevcut dokümanda güncel fiyat ve bugün ifadeleri bulunuyor.'].join('\n')
    expect(routingSurfaceFromMessage(expandedMessage).current).toBe('Kurumsal yapıda kavramsal tasarım dokümanı hazırla.')
  })

  it('makes the primary LLM the substantive execution decision layer', () => {
    expect(gatewaySource).toContain('buildSemanticExecutionPlan')
    expect(gatewaySource).toContain('loadSemanticContext')
    expect(gatewaySource).toContain('get_prior_assistant_execution_context')
    expect(orchestratorSource).toContain("SEMANTIC_ORCHESTRATOR_VERSION = 'primary-llm-agent-v1'")
    expect(orchestratorSource).toContain('semantic_planner_provider_calls_avoided')
    expect(orchestratorSource).toContain('evidenceQueries: []')
    expect(orchestratorSource).not.toContain('requestGeminiPlan')
    expect(orchestratorSource).not.toContain('requestOpenAiPlan')
    expect(providerSource).toContain('const primaryAgentInstruction = AGENT_CONTROLLER_INSTRUCTION')
    expect(controllerPolicySource).toContain('semantik seçimi controller modeli yapar')
    expect(providerSource).toContain('model: requestedModel')
    expect(reasoningSource).toContain('semanticPlanFromMessage')
  })

  it('keeps the existing semantic cache as a cheap capability-envelope cache', () => {
    expect(gatewaySource).toContain("client.rpc('claim_assistant_semantic_plan'")
    expect(gatewaySource).toContain("client.rpc('complete_assistant_semantic_plan'")
    expect(gatewaySource).toContain('semanticRequestHash')
    expect(semanticCacheMigration).toContain('create table if not exists public.assistant_semantic_plans')
    expect(semanticCacheMigration).toContain('public.is_workspace_member(p_workspace_id)')
    expect(semanticCacheMigration).toContain('unique (workspace_id, owner_id, message_id, request_hash)')
    expect(semanticCacheMigration).toContain('to authenticated;')
  })

  it('keeps retries anchored to the original message-time context', () => {
    expect(gatewaySource).toContain(".lt('created_at', currentCreatedAt)")
    expect(gatewaySource).toContain('messageCreatedAt: context.currentCreatedAt')
    expect(gatewaySource).toContain('conversation: context.conversation')
    expect(gatewaySource).toContain('priorExecution: context.priorExecution || null')
  })

  it('does not send context-sensitive acknowledgements down the context-free trivial path', () => {
    expect(gatewaySource).toContain("new Set(['tamam', 'ok', 'okay'])")
    expect(gatewaySource).toContain('CONTEXT_SENSITIVE_ACKNOWLEDGEMENTS.has(normalizeShortText(message))')
  })

  it('does not expose the internal semantic envelope to the final answer model', () => {
    expect(providerSource).toContain('stripInternalSemanticPlan')
    expect(providerSource).toContain('INTERNAL_SEMANTIC_PLAN_PATTERN')
    expect(providerSource).toContain("if ('content' in clean) clean.content = sanitizeContent(clean.content)")
  })

  it('keeps compatibility helpers internal while public Gemini selection is 3.8-only', () => {
    expect(providerSource).toContain('GEMINI_AGENT_MODEL')
    expect(providerSource).toContain('const requestedModel = normalizeGeminiRequestedModel(input.model)')
    expect(providerSource).toContain('primary_llm_agent_calls')
    expect(providerSource).not.toContain('buildGeminiFinalSynthesisItems')
    expect(providerSource).not.toContain('model: GEMINI_AGENT_MODEL')
    expect(settingsSource).toContain('normalizeSelectableModel')
    expect(settingsSource).toContain("PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash'")
    expect(settingsSource).toContain("if (normalized.startsWith('gemini-')) return PUBLIC_GEMINI_MODEL")
    expect(settingsSource).not.toContain("STABLE_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite'")
    expect(publicProviderSource).toContain("PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash'")
    expect(publicProviderSource).toContain('model: PUBLIC_GEMINI_MODEL')
  })

  it('gives OpenAI the same primary-agent policy at developer precedence', () => {
    expect(providerSource).toContain("role: 'developer'")
    expect(providerSource).toContain('openAiPrimaryAgentDeveloperItem')
    expect(providerSource).toContain('primaryAgentInstruction')
    expect(providerSource).toContain('resolvedConversationInstruction')
  })

  it('requires exact evidence for exact Gemini SAP/CRM identifiers', () => {
    const legacyProviderSource = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url), 'utf8')
    expect(legacyProviderSource).toContain('[JETWORK KANIT BÜTÜNLÜĞÜ - ZORUNLU]')
    expect(legacyProviderSource).toContain('yakın kodlar veya benzer SAP süreçleri o kimlik için kanıt değildir')
    expect(legacyProviderSource).toContain('class, method, mesaj metni, tetikleyici veya çözüm uydurma')
  })
})