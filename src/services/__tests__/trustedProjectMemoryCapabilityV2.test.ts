import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_CONTEXT_TOOLS,
  executeContextTool,
} from '../../../supabase/functions/_shared/contextTools.ts'
import { CAPABILITY_REGISTRY } from '../../../supabase/functions/_shared/capabilities/registry.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

const RECORD_PROJECT_MEMORY_TOOL_NAME = 'record_project_memory'

describe('trusted Project Memory capability v3 surface', () => {
  it('is visible to the controller while authenticated provenance remains an executor concern', () => {
    const tool = ASSISTANT_CONTEXT_TOOLS.find(item => item.name === RECORD_PROJECT_MEMORY_TOOL_NAME)
    expect(tool).toBeTruthy()

    const memoryCapability = CAPABILITY_REGISTRY.find(item => item.toolName === RECORD_PROJECT_MEMORY_TOOL_NAME)
    expect(memoryCapability?.category).toBe('context')
    expect(memoryCapability?.metadata.requiresUserProvenance).toBe(true)

    const surface = buildControllerCapabilitySurface([])
    expect(surface.toolNames).toContain(RECORD_PROJECT_MEMORY_TOOL_NAME)
    expect(surface.candidateIds).toEqual([])
  })

  it('never exposes owner or source-message identity to the controller schema', () => {
    const tool = ASSISTANT_CONTEXT_TOOLS.find(item => item.name === RECORD_PROJECT_MEMORY_TOOL_NAME)!
    const properties = tool.parameters.properties as Record<string, unknown>
    expect(properties).toHaveProperty('sourceQuote')
    expect(properties).not.toHaveProperty('ownerId')
    expect(properties).not.toHaveProperty('owner_id')
    expect(properties).not.toHaveProperty('sourceMessageId')
    expect(properties).not.toHaveProperty('source_message_id')
  })

  it('writes through the authenticated trusted RPC using only semantic memory fields plus exact quote', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'memory-id-1', error: null })
    const sourceQuote = 'canlıya geçiş yalnız golden testler yeşil olduktan sonra yapılacak'
    const result = await executeContextTool({
      client: { rpc },
      workspaceId: 'workspace-1',
      toolName: RECORD_PROJECT_MEMORY_TOOL_NAME,
      args: {
        memoryClass: 'DECISION',
        category: 'decision',
        memoryKey: 'rollout_gate',
        value: 'Canlıya geçiş golden testlerden sonra.',
        sourceQuote,
      },
    })

    expect(rpc).toHaveBeenCalledWith('record_agent_project_memory_v2', {
      p_workspace_id: 'workspace-1',
      p_memory_key: 'rollout_gate',
      p_value: 'Canlıya geçiş golden testlerden sonra.',
      p_memory_class: 'DECISION',
      p_category: 'decision',
      p_source_quote: sourceQuote,
    })
    expect(result.summary).toMatchObject({
      durableMemory: true,
      userProvenanceRequired: true,
      citationReady: false,
    })
  })

  it('database contract derives auth identity, resolves a real user message and versions/supersedes atomically', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20260902174500_agent_project_memory_trusted_write.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain('security invoker')
    expect(migration).toContain('v_owner_id uuid := (select auth.uid())')
    expect(migration).toContain("message.workspace_id = p_workspace_id")
    expect(migration).toContain("message.owner_id = v_owner_id")
    expect(migration).toContain("message.role = 'user'")
    expect(migration).toContain("pg_catalog.strpos(coalesce(message.text, ''), v_quote) > 0")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('supersedes_id')
    expect(migration).toContain('to authenticated')
    expect(migration).toContain('from public, anon, service_role')
  })
})
