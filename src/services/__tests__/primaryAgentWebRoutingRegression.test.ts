import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildSemanticExecutionPlan,
  PROVIDER_WEB_CAPABILITY_MARKER,
} from '../../../supabase/functions/_shared/semanticOrchestrator'

describe('primary agent web routing regression', () => {
  it('does not attach provider-native web to an ordinary SAP knowledge question at semantic-plan time', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'SAP standart CRM hata kodları neler',
      conversation: [],
    })

    expect(result.plan.knowledgeRequired).toBe(true)
    expect(result.plan.webMode).toBe('none')
    expect(result.plan.goal).not.toContain(PROVIDER_WEB_CAPABILITY_MARKER)
  })

  it('keeps provider-native web intent when the user explicitly requests web research', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Webde SAP CRM hata kodlarını araştır ve kaynak göster',
      conversation: [],
    })

    expect(result.plan.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER)
    expect(result.plan.webMode).toBe('none')
  })

  it('binds deep research follow-up to the prior user request and keeps Gemini web intent', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      message: 'Bu yanıtı daha derin araştır. Gerektiğinde bilgi bankasını ve web kaynaklarını kullan; bulguları kaynaklarla karşılaştırıp doğrula.',
      conversation: [
        { role: 'user', content: 'CHECK_ZTKS hangi mesajları üretiyor?' },
        { role: 'assistant', content: 'Bu yanıtta doğrulanması gereken ayrıntı için yeterli kanıt bulunamadı.' },
        { role: 'user', content: 'Bu yanıtı daha derin araştır. Gerektiğinde bilgi bankasını ve web kaynaklarını kullan; bulguları kaynaklarla karşılaştırıp doğrula.' },
        { role: 'assistant', content: 'Önceki derin araştır denemesi tamamlanamadı.' },
      ],
      priorExecution: { intent: 'analysis' },
    })

    expect(result.plan.conversationState?.continuation).toBe(true)
    expect(result.plan.conversationState?.topic).toBe('CHECK_ZTKS')
    expect(result.plan.goal).toContain('CHECK_ZTKS hangi mesajları üretiyor?')
    expect(result.plan.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER)
    expect(result.plan.knowledgeRequired).toBe(true)
    expect(result.plan.webMode).toBe('none')
  })

  it('leaves Gemini provider-native web available to the controller instead of forcing deterministic research', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain('const providerWebEnabled = input.allowProviderWeb ?? input.allowTools')
    expect(source).toContain('effectiveAllowTools && providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER')
    expect(source).not.toContain('runDeterministicGeminiWebResearch')
    expect(source).not.toContain('deterministic_web_search_count')
  })

  it('gates legacy preflight research while agentic mode exposes Gemini web capability', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain("configuredProvider === 'gemini'\n          && (AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none' || String(plan.goal || '').includes(PROVIDER_WEB_CAPABILITY_MARKER))")
    expect(source).toContain("if (!AGENTIC_CONTROLLER_ENABLED && plan.webMode === 'required' && !geminiNativeWebPlanned)")
    expect(source).toContain("if (!AGENTIC_CONTROLLER_ENABLED && plan.verificationRequired && !geminiNativeWebPlanned)")
  })
})