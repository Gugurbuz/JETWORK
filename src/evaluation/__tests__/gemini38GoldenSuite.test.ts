import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GEMINI38_GOLDEN_SUITE } from '../gemini38GoldenSuite'
import { normalizeGeminiFunctionCalls } from '../../../supabase/functions/_shared/geminiFunctionContract'
import { buildGeminiContextCachePolicy, clampLargeContextCharacters } from '../../../supabase/functions/_shared/geminiContextCachePolicy'
import { buildGeminiMediaSourceRef, geminiMediaKindForMime } from '../../../supabase/functions/_shared/geminiMultimodalContract'
import {
  buildPublicWorkProtocolInstruction,
  gateGeminiAgentToolsForPublicWork,
} from '../../../supabase/functions/_shared/agent/publicWorkProtocol'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface'

const root = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

describe('Gemini 3.8 G38-01..G38-17 release suite', () => {
  it('contains the complete unique 17-case suite with adaptive work/public lifecycle critical', () => {
    expect(GEMINI38_GOLDEN_SUITE).toHaveLength(17)
    expect(new Set(GEMINI38_GOLDEN_SUITE.map(item => item.id)).size).toBe(17)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-09')?.critical).toBe(true)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-15')?.critical).toBe(true)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-16')?.critical).toBe(true)
    expect(GEMINI38_GOLDEN_SUITE.find(item => item.id === 'G38-17')?.critical).toBe(true)
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

  it('G38-16 keeps goal-plan-evidence-replan-synthesis semantics in controller policy', () => {
    const policy = root('supabase/functions/_shared/agent/controllerPolicy.ts')
    expect(policy).toContain('reactive "ara-bul-ara-bul" değildir')
    expect(policy).toContain('çalışma planı kur')
    expect(policy).toContain('hangi kanıt boşluğunun kaldığını')
    expect(policy).toContain('report_progress(kind=start)')
    expect(policy).toContain('report_progress(kind=finding)')
    expect(policy).toContain('report_progress(kind=plan_change)')
    expect(policy).toContain('`nextCursor` yalnız daha fazla kayıt olduğunu bildirir')
    expect(policy).toContain('geniş prefix ile bütün kataloğu enumerate etme')
    expect(policy).toContain('yeterli kanıt oluştuğunda araç çağırmayı bırakıp sentezle')
  })

  it('G38-17 behaviorally gates tool-backed work behind the model-authored public plan', () => {
    const tools = buildControllerCapabilitySurface().tools
    const before = gateGeminiAgentToolsForPublicWork([], tools, true)
    expect(before.tools.map(tool => tool.name)).toEqual(['report_progress', 'discover_more_capabilities', 'execute_capabilities'])
    expect(before.providerWebEnabled).toBe(false)

    const planArgs = {
      kind: 'start',
      message: 'Bunu Enerjisa teklif/maliyet bağlamında ele alıyorum; önce costing/fixing kullanımını, sonra teknik ilişkisini kontrol edeceğim.',
      resolvedGoal: 'Enerjisa kurumsal satış sürecinde cost alma ve fixing kavramlarının anlamını ve gerçek akışını açıklamak',
      planSteps: ['Costing kullanımını bul', 'Fixing kullanımını bul', 'Ninja/teknik ilişkiyi doğrula', 'Bulguları sentezle'],
      evidenceGaps: ['Ninja ilişkisi henüz doğrulanmadı'],
      sourceRefs: null,
    }
    const started = [
      { type: 'function_call', call_id: 'start_1', name: 'report_progress', arguments: JSON.stringify(planArgs) },
      { type: 'function_call_output', call_id: 'start_1', output: JSON.stringify({ ok: true, kind: 'start', sequence: 1 }) },
    ]
    const after = gateGeminiAgentToolsForPublicWork(started, tools, true)
    expect(after.tools.map(tool => tool.name)).toEqual(tools.map(tool => tool.name))
    expect(after.providerWebEnabled).toBe(true)

    const emptySearch = [
      ...started,
      { type: 'function_call', call_id: 'search_1', name: 'search_knowledge_catalog', arguments: JSON.stringify({ query: 'Cost fix', limit: 5 }) },
      { type: 'function_call_output', call_id: 'search_1', output: JSON.stringify({ resultCount: 0, candidateSourceCount: 0 }) },
    ]
    const replan = buildPublicWorkProtocolInstruction(emptySearch, true)
    expect(replan).toContain('Tek boş sorguyu "kurumsal kaynak yok" sonucu sayma')
    expect(replan).toContain('report_progress(kind=plan_change)')
  })

  it('keeps media out of verified enterprise-knowledge authority', () => {
    const grounding = root('supabase/functions/_shared/groundingGuard.ts')
    expect(grounding).toContain("source.sourceType === 'knowledge' || !source.sourceType")
    expect(grounding).not.toContain("source.sourceType !== 'web'\n    && Boolean(clean(source.canonicalKey")
  })
})