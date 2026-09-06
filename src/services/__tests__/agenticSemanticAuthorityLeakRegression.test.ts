import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { discoverIndexedCapabilities } from '../../../supabase/functions/_shared/capabilities/indexedDiscovery.ts'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator.ts'

const internalGatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-internal/index.ts', import.meta.url),
  'utf8',
)

describe('Agentic semantic authority leak regressions', () => {
  it('materializes the internal gateway locally instead of pinning an old remote runtime', () => {
    expect(internalGatewaySource).toContain("import '../openai-assistant-v2/index.ts'")
    expect(internalGatewaySource).not.toContain('raw.githubusercontent.com')
    expect(internalGatewaySource).not.toMatch(/[0-9a-f]{40}\/supabase\/functions\/openai-assistant-v2/)
  })

  it('keeps Controller V2 preplanning semantically neutral across freshness phrasings', async () => {
    const requests = [
      'İYS entegrasyon dokümanına ihtiyacım var güncel',
      'İYS için en son geçerli entegrasyon dokümanını bul',
      'İYS entegrasyonunda şu an kullanılan doküman hangisi',
      'İYS vendorının son dokümanını incele',
      'İYS entegrasyonunun mevcut sürüm dokümantasyonuna ihtiyacım var',
    ]

    for (const message of requests) {
      const result = await buildSemanticExecutionPlan({
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        message,
        conversation: [],
        agentControllerV2Enabled: true,
      })

      expect(result.plan).toMatchObject({
        intent: 'analysis',
        complexity: 'medium',
        executionMode: 'direct',
        knowledgeRequired: false,
        webMode: 'none',
        verificationRequired: false,
      })
      expect(result.plan.evidenceQueries).toEqual([])
      expect(result.usage?.controller_v2_advisory_plan).toBe(1)
    }
  })

  it('never lets semantic Top-K hide foundational web and knowledge evidence capabilities', async () => {
    const result = await discoverIndexedCapabilities({
      client: null,
      geminiApiKey: undefined,
      query: 'İYS entegrasyon dokümanına ihtiyacım var güncel',
      topK: 1,
    })
    const ids = new Set(result.candidates.map(candidate => candidate.id))

    expect(ids.has('provider:web_search')).toBe(true)
    expect(ids.has('tool:search_knowledge_catalog')).toBe(true)
    expect(ids.has('tool:list_knowledge_catalog')).toBe(true)
    expect(ids.has('tool:get_knowledge_object')).toBe(true)
    expect(ids.has('tool:get_knowledge_objects')).toBe(true)
    expect(ids.has('tool:get_related_objects')).toBe(true)
  })

  it('respects discovery exclusions so foundational options do not loop during discover-more', async () => {
    const excluded = [
      'provider:web_search',
      'tool:search_knowledge_catalog',
      'tool:list_knowledge_catalog',
      'tool:get_knowledge_object',
      'tool:get_knowledge_objects',
      'tool:get_related_objects',
    ]
    const result = await discoverIndexedCapabilities({
      client: null,
      geminiApiKey: undefined,
      query: 'current public integration documentation',
      topK: 1,
      excludeIds: excluded,
    })
    const ids = new Set(result.candidates.map(candidate => candidate.id))
    for (const id of excluded) expect(ids.has(id)).toBe(false)
  })
})
