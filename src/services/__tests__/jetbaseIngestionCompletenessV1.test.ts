import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260909102000_jetbase_ingestion_completeness_v1.sql', import.meta.url),
  'utf8',
)

const worker = readFileSync(
  new URL('../../../supabase/functions/jetbase-embedding-backfill-internal/index.ts', import.meta.url),
  'utf8',
)

const config = readFileSync(
  new URL('../../../supabase/config.toml', import.meta.url),
  'utf8',
)

describe('JetBase ingestion completeness v1', () => {
  it('deduplicates exact source bytes across the whole knowledge space', () => {
    expect(migration).toContain('knowledge_source_versions_v2_space_content_hash_uq')
    expect(migration).toContain('(knowledge_space_id, content_hash)')
    expect(migration).toContain("'dedupScope', 'knowledge_space_content_hash'")
    expect(migration).toContain('pg_advisory_xact_lock')
  })

  it('keeps the existing ABAP SQL graph guard at the ingestion boundary', () => {
    expect(migration).toContain('is_valid_abap_table_relation_v5')
    expect(migration).toContain('ingest_knowledge_catalog_v2_unsanitized_v5')
    expect(migration).toContain("'abapSqlGuardVersion','v5'")
  })

  it('queues every published source version that still has missing embeddings', () => {
    expect(migration).toContain('jetbase_embedding_backfill_requests_v1')
    expect(migration).toContain('c.embedding is null')
    expect(migration).toContain('jetbase_embedding_backfill_job_enqueue_v1')
  })

  it('uses Gemini batch embeddings and persists 768-dimensional vectors', () => {
    expect(worker).toContain(':batchEmbedContents')
    expect(worker).toContain("taskType: 'RETRIEVAL_DOCUMENT'")
    expect(worker).toContain('outputDimensionality: 768')
    expect(worker).toContain("rpc('apply_jetbase_embedding_batch_v1'")
    expect(migration).toContain("jsonb_array_length(item->'embedding') <> 768")
  })

  it('keeps the internal worker outside JWT auth only because it has a generated DB webhook secret', () => {
    expect(config).toContain('[functions.jetbase-embedding-backfill-internal]\nverify_jwt = false')
    expect(migration).toContain('embedding_backfill_webhook_secret')
    expect(migration).toContain('encode(gen_random_bytes(32)')
    expect(worker).toContain("suppliedSecret !== config.secret")
  })

  it('does not grant the internal queue or secret table to authenticated users', () => {
    expect(migration).toContain('revoke all on table public.jetbase_internal_config_v1 from public, anon, authenticated')
    expect(migration).toContain('revoke all on table public.jetbase_embedding_backfill_requests_v1 from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.apply_jetbase_embedding_batch_v1(uuid,jsonb) to service_role')
  })
})
