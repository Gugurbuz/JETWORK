import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildProjectMemoryWriteRequests,
  persistProjectMemoryCandidatesV2,
} from '../../../supabase/functions/_shared/context/projectMemoryStore.ts'

const storeSource = readFileSync(
  new URL('../../../supabase/functions/_shared/context/projectMemoryStore.ts', import.meta.url),
  'utf8',
)
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260902163000_agent_project_memory_v2.sql', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 Project Memory persistence', () => {
  it('never imports legacy raw-message memory extraction into the V2 store', () => {
    expect(storeSource).not.toContain('extractProjectMemoryUpdates')
    expect(storeSource).not.toContain('extractStructuredProjectMemory')
    expect(storeSource).toContain('durableProjectMemoryCandidates')
  })

  it('maps only user-owned decisions/facts/corrections to confirmed Project Memory writes', () => {
    const requests = buildProjectMemoryWriteRequests({
      workspaceId: 'workspace-1',
      ownerId: '00000000-0000-0000-0000-000000000001',
      sourceMessageId: 'message-1',
      candidates: [
        { class: 'DECISION', key: 'runtime.rollout', value: 'internal canary', source: 'user' },
        { class: 'PROJECT_FACT', key: 'project.scope', value: 'B2B CRM', source: 'user' },
        { class: 'CORRECTION', key: 'runtime.rollout', value: '10 percent canary', source: 'user', correctionTarget: 'decision' },
        { class: 'PROJECT_FACT', key: 'technical.claim', value: 'verified tool claim', source: 'verified_evidence', evidenceRefs: ['knowledge:x'] },
        { class: 'AI_HYPOTHESIS', key: 'guess', value: 'maybe cache', source: 'assistant' },
      ],
    })

    expect(requests.map(request => [request.memoryKey, request.category])).toEqual([
      ['runtime.rollout', 'decision'],
      ['project.scope', 'fact'],
      ['runtime.rollout', 'decision'],
    ])
    expect(requests.every(request => request.sourceMessageId === 'message-1')).toBe(true)
  })

  it('uses the atomic version/supersede RPC and skips non-durable candidates', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const result = await persistProjectMemoryCandidatesV2({
      client: {
        rpc: async (name, args) => {
          calls.push({ name, args })
          return { data: `saved-${calls.length}`, error: null }
        },
      },
      workspaceId: 'workspace-1',
      ownerId: '00000000-0000-0000-0000-000000000001',
      sourceMessageId: 'message-1',
      candidates: [
        { class: 'DECISION', key: 'runtime.rollout', value: 'internal canary', source: 'user' },
        { class: 'PROJECT_FACT', key: 'technical.claim', value: 'verified tool claim', source: 'verified_evidence', evidenceRefs: ['knowledge:x'] },
        { class: 'PROGRESS', key: 'p3', value: 'done', source: 'runtime', progressState: 'completed' },
      ],
    })

    expect(result).toMatchObject({ ok: true, attemptedCount: 1, savedCount: 1, skippedCount: 2 })
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('persist_agent_project_memory_v2')
    expect(calls[0].args).toMatchObject({
      p_memory_key: 'runtime.rollout',
      p_category: 'decision',
    })
  })

  it('serializes same-key writes and hard-codes trusted provenance in the database RPC', () => {
    expect(migrationSource).toContain('pg_advisory_xact_lock')
    expect(migrationSource).toContain('memory_version')
    expect(migrationSource).toContain('supersedes_id')
    expect(migrationSource).toContain("'user_message'")
    expect(migrationSource).toContain("'confirmed'")
    expect(migrationSource).toContain('grant execute on function public.persist_agent_project_memory_v2')
    expect(migrationSource).toContain('to service_role')
    expect(migrationSource).toContain('from public, anon, authenticated')
  })
})
