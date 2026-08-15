import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const legacyProviderSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
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

describe('Gemini web observability and streaming contract', () => {
  it('preserves incremental Gemini grounding metadata and exposes it structurally', () => {
    expect(legacyProviderSource).toContain('webSources?: Array<{ title: string; url: string }>')
    expect(legacyProviderSource).toContain('webSearchQueries?: string[]')
    expect(legacyProviderSource).toContain('mergeGroundingMetadata')
    expect(legacyProviderSource).toContain("'groundingChunks', 'groundingSupports', 'webSearchQueries'")
    expect(legacyProviderSource).toContain('webSources,')
    expect(legacyProviderSource).toContain('webSearchQueries,')
  })

  it('prefers official and primary sources for provider-native research', () => {
    expect(legacyProviderSource).toContain('GEMINI_WEB_SOURCE_PRIORITY_INSTRUCTIONS')
    expect(legacyProviderSource).toMatch(/önce resmi ve birincil kaynakları kullan/iu)
    expect(legacyProviderSource).toMatch(/resmi geliştirici\/API dokümantasyonu/iu)
  })

  it('turns Gemini grounding into first-class web telemetry and source refs', () => {
    expect(coreSource).toContain('extractGeminiWebSources')
    expect(coreSource).toContain("toolName: 'gemini_google_search'")
    expect(coreSource).toContain('gemini_native_web_used: 1')
    expect(coreSource).toContain('gemini_native_web_source_count')
    expect(coreSource).toContain("sourceType: 'web'")
    expect(coreSource).toContain("emitStatus('searching_web', `${finalWebSources.length} web kaynağı toplandı`)")
    expect(coreSource).toContain("emitStatus('verifying', 'Google grounding kaynakları yanıtla eşleştirildi')")
  })

  it('passes safe Gemini public-research deltas through immediately without replaying the full answer', () => {
    expect(coreSource).toContain('const canLiveStreamProviderText = activeProvider === \'gemini\'')
    expect(coreSource).toContain("sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta })")
    expect(coreSource).toContain("if (!roundTextStreamed) sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: roundText })")
    expect(coreSource).toContain("plan.enterpriseGroundingRequired !== true")
    expect(coreSource).toContain("plan.intent !== 'sap_diagnosis'")
  })

  it('persists measured stream timing after the turn completes', () => {
    expect(liveProxySource).toContain('persistStreamTiming')
    expect(liveProxySource).toContain('stream_first_text_delta_ms')
    expect(liveProxySource).toContain('stream_last_text_delta_ms')
    expect(liveProxySource).toContain('stream_text_delta_count')
    expect(liveProxySource).toContain('stream_total_ms')
    expect(liveProxySource).toContain('streamTiming: snapshot')
    expect(liveProxySource).toContain("X-JetWork-Live-Progress': 'v5")
  })
})