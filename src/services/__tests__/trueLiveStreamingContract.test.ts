import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent'
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy'

const legacyProviderSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
  'utf8',
)
const runtimeSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts', import.meta.url),
  'utf8',
)
const transportSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsTransportGA.ts', import.meta.url),
  'utf8',
)
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const liveProxySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-live-proxy/index.ts', import.meta.url),
  'utf8',
)

const basePlan = () => ({
  intent: 'analysis' as const,
  complexity: 'low' as const,
  executionMode: 'direct' as const,
  goal: '',
  knowledgeRequired: true,
  enterpriseGroundingRequired: false,
  webMode: 'none' as const,
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  promptProfile: 'base' as const,
  orchestratorVersion: 'primary-llm-agent-v1',
  conversationState: {
    continuation: false,
    topic: '',
    userMove: 'new_request' as const,
    priorIntent: 'none' as const,
    rejectedHypotheses: [],
    rejectedScopes: [],
    retainedContext: [],
    openQuestions: [],
  },
})

describe('true live assistant streaming contract', () => {
  it('keeps the legacy Gemini streaming adapter safe for compatibility paths', () => {
    expect(legacyProviderSource).toContain('generateContentStream')
    expect(legacyProviderSource).not.toContain("INJECTED_GEMINI_THOUGHT_SIGNATURE = 'context_engineering_is_the_way to_go'")
    expect(legacyProviderSource).not.toContain('thoughtSignature: INJECTED_GEMINI_THOUGHT_SIGNATURE')
    expect(legacyProviderSource).toContain('_geminiContent: candidateContent')
    expect(legacyProviderSource).toContain('providerFunctionCallIds')
    expect(legacyProviderSource).toContain("item._geminiSkipContent === true")
    expect(legacyProviderSource).toContain('[JETWORK_TOOL_EVIDENCE name=${name}]')
    expect(legacyProviderSource).toContain('!providerFunctionCallIds.has(callId)')
    expect(legacyProviderSource).toContain('for await (const chunk of stream')
  })

  it('streams active Gemini 3.8 GA Interactions text and real provider-tool lifecycle incrementally', () => {
    expect(runtimeSource).toContain('buildGeminiInteractionsRequest')
    expect(runtimeSource).toContain('previous_interaction_id')
    expect(transportSource).toContain("GEMINI_INTERACTIONS_API_VERSION = 'v1'")
    expect(transportSource).toContain('?alt=sse')
    expect(transportSource).toContain("eventType === 'step.delta'")
    expect(transportSource).toContain("deltaType === 'text'")
    expect(transportSource).toContain('builder.text += delta.text')
    expect(transportSource).toContain('input.onText(delta.text)')
    expect(transportSource).toContain('input.onStepEvent?.')
    expect(transportSource).toContain('gemini_provider_first_text_ms')
    expect(transportSource).toContain('gemini_previous_interaction_used')
    expect(coreSource).toContain("sendEvent(controller, encoder, 'provider_step'")
    expect(coreSource).toContain('evaluateGroundedTechnicalClaims')
    expect(coreSource).toContain('shouldFailClosedGroundedAnswer')
  })

  it('surfaces real memory and plan activity without router metadata counts', () => {
    expect(liveProxySource).toContain('Önceki konuşma bağlamı hatırlanıyor...')
    expect(liveProxySource).toContain(".from('assistant_semantic_plans')")
    expect(liveProxySource).toContain("`Plan: ${planLabels.join(' → ')}`")
    expect(liveProxySource).toContain("return 'Talebin kapsamı değerlendirildi'")
  })

  it('records actual SSE arrival timing instead of inferring streaming from total duration', () => {
    expect(liveProxySource).toContain('firstTextDeltaMs')
    expect(liveProxySource).toContain('lastTextDeltaMs')
    expect(liveProxySource).toContain('textDeltaCount')
    expect(liveProxySource).toContain('ASSISTANT_LIVE_STREAM_TIMING')
    expect(liveProxySource).toContain('streamTiming: timingSnapshot')
  })

  it('keeps explicit research intent on compatibility policy paths when a message begins as a definition lookup', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'İys nedir nasıl entegre olunur teknik api vb araştır',
      conversation: [],
    })

    expect(plan.intent).toBe('research')
    expect(plan.executionMode).toBe('research')
    expect(plan.webMode).toBe('required')
    expect(plan.knowledgeRequired).toBe(true)
    expect(plan.steps.some(step => step.toolHint === 'web')).toBe(true)
    expect(plan.steps.map(step => step.label).join(' ')).toMatch(/resmi web kaynaklarında/iu)
  })

  it('keeps a plain internal definition lookup knowledge-only on compatibility policy paths', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'CHECK_ZTKS nedir',
      conversation: [],
    })

    expect(plan.webMode).toBe('none')
    expect(plan.executionMode).toBe('knowledge')
  })

  it('does not turn a long analysis prompt into a document artifact merely because it mentions documents and later asks for a plan', () => {
    const prompt = [
      'JetWork mimarisini kapsamlı biçimde analiz et.',
      'RAG ve farklı doküman türlerini, Excel/PDF/DOCX/PPTX işlemlerini ve canlı çalışma akışını değerlendir.',
      'Riskleri karşılaştır ve her madde için mevcut durum, problem, önerilen çözüm ve nasıl test edilir şeklinde somut bir geliştirme planı oluştur.',
    ].join(' ')

    expect(resolveAssistantDocumentRequestMode(prompt, null)).toBe('none')
  })
})
