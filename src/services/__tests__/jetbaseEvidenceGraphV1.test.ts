import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260909090000_jetbase_evidence_graph_v1.sql', import.meta.url),
  'utf8',
)

describe('Jetbase Evidence Graph v1 migration contract', () => {
  it('classifies relation provenance without replacing the existing graph', () => {
    expect(migration).toContain("add column if not exists extraction_type text not null default 'EXTRACTED'")
    expect(migration).toContain("('EXTRACTED','INFERRED','AMBIGUOUS')")
    expect(migration).toContain("metadata->>'inferredFrom','') = 'semantic_compiler'")
    expect(migration).toContain("metadata->>'reviewRequired','false'")
    expect(migration).toContain('add column if not exists confidence numeric(5,4)')
    expect(migration).toContain("add column if not exists source_location jsonb")
  })

  it('creates a relation-derived claim ledger with source evidence', () => {
    expect(migration).toContain('create table if not exists public.knowledge_claims_v1')
    expect(migration).toContain('create table if not exists public.knowledge_claim_evidence_v1')
    expect(migration).toContain("evidence_kind in ('SUPPORTS','CONTRADICTS','MENTIONS')")
    expect(migration).toContain("verification_status in ('LITERAL','NON_LITERAL','NO_EVIDENCE')")
    expect(migration).toContain("position(lower(trim(new.evidence)) in lower(coalesce(v_raw_text,'')))")
    expect(migration).toContain('trg_knowledge_relation_claim_sync_v1')
  })

  it('keeps claim/evidence writes out of the authenticated client surface', () => {
    expect(migration).toContain('alter table public.knowledge_claims_v1 enable row level security')
    expect(migration).toContain('alter table public.knowledge_claim_evidence_v1 enable row level security')
    expect(migration).toContain('grant select on table public.knowledge_claims_v1 to authenticated')
    expect(migration).toContain('grant select on table public.knowledge_claim_evidence_v1 to authenticated')
    expect(migration).not.toContain('grant insert on table public.knowledge_claims_v1 to authenticated')
    expect(migration).not.toContain('grant update on table public.knowledge_claims_v1 to authenticated')
  })

  it('exposes a bounded read-only evidence pack instead of a semantic router', () => {
    expect(migration).toContain('create or replace function public.get_knowledge_evidence_pack_v1')
    expect(migration).toContain('greatest(1,least(coalesce(p_hops,1),2))')
    expect(migration).toContain('greatest(1,least(coalesce(p_limit,24),40))')
    expect(migration).toContain('security invoker')
    expect(migration).toContain("q.review_type in ('possible_conflict','low_confidence_relation')")
    expect(migration).toContain("'citationReady',exists(select 1 from selected_edges)")
    expect(migration).toContain('This is a read capability, not a planner/router.')
  })

  it('preserves project-over-global precedence in the bounded subgraph', () => {
    expect(migration).toContain("select project_space_id as id,'project'::text as scope_type,0 as priority")
    expect(migration).toContain("select global_space_id,'global'::text,1")
    expect(migration).toContain('order by r.priority,r.confidence desc,r.created_at desc')
  })
})
