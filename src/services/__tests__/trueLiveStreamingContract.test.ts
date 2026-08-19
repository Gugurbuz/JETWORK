import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent'
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
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
  it('uses the Gemini streaming API without fabricating signatures for synthetic tool calls', () => {
    expect(providerSource).toContain('generateContentStream')
    expect(providerSource).not.toContain("INJECTED_GEMINI_THOUGHT_SIGNATURE = 'context_engineering_is_the_way to_go'")
    expect(providerSource).not.toContain('thoughtSignature: INJECTED_GEMINI_THOUGHT_SIGNATURE')
    expect(providerSource).toContain('_geminiContent: candidateContent')
    expect(providerSource).toContain('providerFunctionCallIds')
    expect(providerSource).toContain("item._geminiSkipContent === true")
    expect(providerSource).toContain('[JETWORK_TOOL_EVIDENCE name=${name}]')
    expect(providerSource).toContain('!providerFunctionCallIds.has(callId)')
    expect(providerSource).toContain('for await (const chunk of stream')
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

  it('keeps explicit research intent when a message begins as a definition lookup', () => {
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

  it('keeps a plain internal definition lookup knowledge-only when web research was not requested', () => {
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
