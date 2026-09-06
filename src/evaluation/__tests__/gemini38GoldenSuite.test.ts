import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GEMINI38_GOLDEN_SUITE } from '../gemini38GoldenSuite'
import { normalizeGeminiFunctionCalls } from '../../../supabase/functions/_shared/geminiFunctionContract'
import { buildGeminiContextCachePolicy, clampLargeContextCharacters } from '../../../supabase/functions/_shared/geminiContextCachePolicy'
import { buildGeminiMediaSourceRef, geminiMediaKindForMime } from '../../../supabase/functions/_shared/geminiMultimodalContract'

const root = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('Gemini 3.8 G38-01..G38-15 release suite', () => {
  it('contains the complete unique 15-case suite with G38-09 and G38-15 critical', () => {
    expect(GEMINI38_GOLDEN_SUITE).toHaveLength(15)
    expect(new Set(GEMINI38_GOLDEN_SUITE.map(item => item.id)).size).toBe(15)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-09')?.critical).toBe(true)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-15')?.critical).toBe(true)
  })

  it('G38-06 normalizes image, PDF, audio and video evidence by content hash', () => {
    expect(geminiMediaKindForMime('image/png')).toBe('image')
    expect(geminiMediaKindForMime('application/pdf')).toBe('pdf')
    expect(geminiMediaKindForMime('audio/mpeg')).toBe('audio')
    expect(geminiMediaKindForMime('video/mp4')).toBe('video')
    const hash = 'a'.repeat(64)
    expect(buildGeminiMediaSourceRef({ name: 'screen.png', mimeType: 'image/png', contentHash: hash })).toMatchObject({
      sourceId: `media:${hash}`, sourceType: 'media', mediaKind: 'image', authority: 'user_input',
    })
  })

  it('G38-09/G38-15 preserve exact ids for multiple calls and reject missing ids', () => {
    expect(normalizeGeminiFunctionCalls([
      { functionCall: { id: 'call_a', name: 'get_knowledge_object', args: { canonicalKey: 'method:x/y' } } },
      { functionCall: { id: 'call_b', name: 'get_related_objects', args: { canonicalKey: 'method:x/y' } } },
    ])).toEqual([
      { id: 'call_a', name: 'get_knowledge_object', args: { canonicalKey: 'method:x/y' } },
      { id: 'call_b', name: 'get_related_objects', args: { canonicalKey: 'method:x/y' } },
    ])
    expect(() => normalizeGeminiFunctionCalls([{ functionCall: { name: 'x', args: {} } }])).toThrow('GEMINI_FUNCTION_CALL_ID_MISSING')
  })

  it('G38-10 cache key versions stable context and large context is mechanically bounded', async () => {
    const base = { workspaceId: 'w', projectId: 'p', promptVersionId: 'v12', model: 'gemini-3.8-flash', stablePrompt: 'x'.repeat(20_000), controllerVersion: 'c2', capabilityManifestVersion: 'm2' }
    const first = await buildGeminiContextCachePolicy(base)
    const same = await buildGeminiContextCachePolicy(base)
    const changed = await buildGeminiContextCachePolicy({ ...base, promptVersionId: 'v13' })
    expect(first.cacheKey).toBe(same.cacheKey)
    expect(first.cacheKey).not.toBe(changed.cacheKey)
    expect(first.eligible).toBe(true)
    expect(clampLargeContextCharacters(999_999)).toBe(240_000)
  })

  it('G38-11/G38-12 use explicit work mode only and never MINIMAL', () => {
    const provider = root('supabase/functions/_shared/modelProvidersLegacy.ts')
    expect(provider).toContain("input.workMode === 'fast'")
    expect(provider).toContain("input.workMode === 'deep'")
    expect(provider).not.toContain("thinkingLevel: 'minimal'")
  })

  it('G38-13 has an explicit production-default rollback flag without altering explicit Gemini selection', () => {
    const gateway = root('supabase/functions/openai-assistant-v2/index.ts')
    expect(gateway).toContain('GEMINI_38_PRODUCTION_DEFAULT')
    expect(gateway).toContain("requestedModel.startsWith('gemini-')")
    expect(gateway).toContain('gemini38DefaultEnabled')
  })

  it('G38-14 removes unsupported sampling fields from every Gemini 3.8 helper builder', () => {
    for (const path of ['supabase/functions/artifact-execute/index.ts', 'supabase/functions/ingest-knowledge-source/index.ts']) {
      const source = root(path)
      expect(source).toContain('gemini-3.8-flash')
      expect(source).not.toMatch(/generationConfig:\s*\{[^}]*temperature/s)
      expect(source).not.toMatch(/generationConfig:\s*\{[^}]*topP/s)
    }
  })

  it('keeps media out of verified enterprise-knowledge authority', () => {
    const grounding = root('supabase/functions/_shared/groundingGuard.ts')
    expect(grounding).toContain("source.sourceType === 'knowledge' || !source.sourceType")
    expect(grounding).not.toContain("source.sourceType !== 'web'\n    && Boolean(clean(source.canonicalKey")
  })
})
