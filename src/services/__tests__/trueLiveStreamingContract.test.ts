import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
  'utf8',
)
const liveProxySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-live-proxy/index.ts', import.meta.url),
  'utf8',
)

describe('true live assistant streaming contract', () => {
  it('uses the Gemini streaming API and preserves signatures for injected tool calls', () => {
    expect(providerSource).toContain('generateContentStream')
    expect(providerSource).toContain("INJECTED_GEMINI_THOUGHT_SIGNATURE = 'context_engineering_is_the_way to_go'")
    expect(providerSource).toContain('thoughtSignature: INJECTED_GEMINI_THOUGHT_SIGNATURE')
    expect(providerSource).toContain('for await (const chunk of stream')
  })

  it('surfaces real memory and plan activity without router metadata counts', () => {
    expect(liveProxySource).toContain('Önceki konuşma bağlamı hatırlanıyor...')
    expect(liveProxySource).toContain('loadReasoningPlanLabels')
    expect(liveProxySource).toContain("`Plan: ${planLabels.join(' → ')}`")
    expect(liveProxySource).toContain("return 'Talebin kapsamı değerlendirildi'")
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
