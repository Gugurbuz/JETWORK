import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_CONTEXT_TOOLS,
  executeContextTool,
} from '../../../supabase/functions/_shared/context/contextTools.ts'

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260902174500_agent_project_memory_trusted_write.sql', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 trusted Project Memory capability', () => {
  it('never lets the model choose owner_id or source_message_id', () => {
    const tool = ASSISTANT_CONTEXT_TOOLS.find(item => item.name === 'record_project_memory')
    expect(tool).toBeTruthy()
    const properties = tool!.parameters.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('ownerId')
    expect(properties).not.toHaveProperty('owner_id')
    expect(properties).not.toHaveProperty('sourceMessageId')
    expect(properties).not.toHaveProperty('source_message_id')
    expect(properties).toHaveProperty('sourceQuote')
  })

  it('calls only the authenticated trusted-write RPC with exact quote provenance', async () => {
    const rpc = vi.fn(async () => ({ data: 'memory-1', error: null }))
    const result = await executeContextTool({
      client: { rpc },
      workspaceId: 'workspace-1',
      toolName: 'record_project_memory',
      args: {
        memoryClass: 'DECISION',
        category: 'decision',
        memoryKey: 'runtime.rollout',
        value: 'internal users first',
        sourceQuote: 'önce internal kullanıcılarla açalım',
      },
    })

    expect(rpc).toHaveBeenCalledWith('record_agent_project_memory_v2', {
      p_workspace_id: 'workspace-1',
      p_memory_key: 'runtime.rollout',
      p_value: 'internal users first',
      p_memory_class: 'DECISION',
      p_category: 'decision',
      p_source_quote: 'önce internal kullanıcılarla açalım',
    })
    expect(result.summary).toMatchObject({ durableMemory: true, userProvenanceRequired: true })
  })

  it('derives owner and source message inside SECURITY INVOKER SQL and grants only authenticated execution', () => {
    expect(migrationSource).toContain('security invoker')
    expect(migrationSource).toContain('v_owner_id uuid := (select auth.uid())')
    expect(migrationSource).toContain("message.owner_id = v_owner_id")
    expect(migrationSource).toContain("message.role = 'user'")
    expect(migrationSource).toContain('pg_catalog.strpos(coalesce(message.text, \'\'), v_quote) > 0')
    expect(migrationSource).toContain('v_source_message_id')
    expect(migrationSource).toContain('pg_advisory_xact_lock')
    expect(migrationSource).toContain('supersedes_id')
    expect(migrationSource).toContain('grant execute on function public.record_agent_project_memory_v2')
    expect(migrationSource).toContain('to authenticated')
    expect(migrationSource).toContain('from public, anon, service_role')
  })
})
