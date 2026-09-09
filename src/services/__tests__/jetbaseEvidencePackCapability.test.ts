import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const assistantTools = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)
const migration = readFileSync(
  new URL('../../../supabase/migrations/20260909090000_jetbase_evidence_graph_v1.sql', import.meta.url),
  'utf8',
)

describe('Jetbase evidence-pack assistant capability', () => {
  it('exposes a bounded knowledge tool without prescribing a semantic route', () => {
    expect(assistantTools).toContain("name: 'get_knowledge_evidence_pack'")
    expect(assistantTools).toContain("hops: { type: 'integer', minimum: 1, maximum: 2 }")
    expect(assistantTools).toContain("limit: { type: 'integer', minimum: 1, maximum: 40 }")
    expect(assistantTools).toContain('This capability only reads evidence; it does not plan, route or decide the next action.')
  })

  it('executes the evidence-pack RPC and preserves verified source refs', () => {
    expect(assistantTools).toContain("client.rpc('get_knowledge_evidence_pack_v1'")
    expect(assistantTools).toContain("verifiedToolOutput('get_knowledge_evidence_pack', pack)")
    expect(assistantTools).toContain("graphEvidencePack: true")
    expect(assistantTools).toContain("if (toolName === 'get_knowledge_evidence_pack') return getKnowledgeEvidencePack")
  })

  it('keeps the database function bounded and read-only', () => {
    expect(migration).toContain('p_hops integer default 1')
    expect(migration).toContain('p_limit integer default 24')
    expect(migration).toContain('security invoker')
    expect(migration).toContain("revoke all on function public.get_knowledge_evidence_pack_v1(text,text,integer,integer) from public, anon")
    expect(migration).toContain("grant execute on function public.get_knowledge_evidence_pack_v1(text,text,integer,integer) to authenticated, service_role")
  })
})
