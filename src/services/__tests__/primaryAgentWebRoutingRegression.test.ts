import { describe, expect, it } from 'vitest'
import {
  buildSemanticExecutionPlan,
  PROVIDER_WEB_CAPABILITY_MARKER,
} from '../../../supabase/functions/_shared/semanticOrchestrator'

describe('primary agent web routing regression', () => {
  it('does not attach provider-native web to an ordinary SAP knowledge question', async () => {
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

  it('keeps provider-native web when the user explicitly requests web research', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: 'Webde SAP CRM hata kodlarını araştır ve kaynak göster',
      conversation: [],
    })

    expect(result.plan.goal).toContain(PROVIDER_WEB_CAPABILITY_MARKER)
    expect(result.plan.webMode).toBe('none')
  })
})
