import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_EMBEDDING_DIMENSIONS,
  CAPABILITY_EMBEDDING_MODEL,
} from '../../../supabase/functions/_shared/capabilities/embeddings.ts'
import { discoverIndexedCapabilities } from '../../../supabase/functions/_shared/capabilities/indexedDiscovery.ts'

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260902154500_agent_capability_index.sql', import.meta.url),
  'utf8',
)
const storeSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/indexStore.ts', import.meta.url),
  'utf8',
)
const embeddingSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/embeddings.ts', import.meta.url),
  'utf8',
)

describe('Agent capability embedding index contract', () => {
  it('reuses the existing JetWork 768-dimensional Gemini embedding standard', () => {
    expect(CAPABILITY_EMBEDDING_MODEL).toBe('gemini-embedding-001')
    expect(CAPABILITY_EMBEDDING_DIMENSIONS).toBe(768)
    expect(embeddingSource).toContain("taskType: 'RETRIEVAL_QUERY'")
    expect(embeddingSource).toContain("taskType: 'RETRIEVAL_DOCUMENT'")
    expect(embeddingSource).toContain('outputDimensionality: CAPABILITY_EMBEDDING_DIMENSIONS')
  })

  it('stores candidate metadata in pgvector/HNSW without exposing direct client execution access', () => {
    expect(migrationSource).toContain('embedding vector(768)')
    expect(migrationSource).toContain('using hnsw (embedding vector_cosine_ops)')
    expect(migrationSource).toContain('match_assistant_capabilities')
    expect(migrationSource).toContain('limit greatest(1, least(coalesce(p_match_count, 10), 12))')
    expect(migrationSource).toContain('grant execute on function public.match_assistant_capabilities(vector, integer, text[]) to service_role')
    expect(migrationSource).toContain('revoke all on table public.assistant_capability_index from anon, authenticated')
    expect(migrationSource).not.toContain('grant execute on function public.match_assistant_capabilities(vector, integer, text[]) to authenticated')
  })

  it('keeps index synchronization separate from provider choice and tool execution', () => {
    expect(storeSource).toContain('embedDocuments: (semanticTexts: readonly string[]) => Promise<number[][]>')
    expect(storeSource).not.toContain('GEMINI_API_KEY')
    expect(storeSource).not.toContain('executeAssistantTool')
    expect(storeSource).not.toContain('executeSkillTool')
  })

  it('falls back to lexical candidates when the embedding provider is unavailable', async () => {
    let rpcCalled = false
    const result = await discoverIndexedCapabilities({
      client: { rpc: async () => { rpcCalled = true; return { data: [], error: null } } },
      query: 'Enerjisa analiz dokümanı',
      topK: 8,
    })
    expect(result.mode).toBe('lexical_fallback')
    expect(result.fallbackReason).toBe('embedding_provider_unavailable')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(rpcCalled).toBe(false)
  })
})
