import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  executeContextTool,
  RECORD_PROJECT_MEMORY_TOOL_NAME,
} from '../../../supabase/functions/_shared/contextTools.ts'
import { CAPABILITY_REGISTRY } from '../../../supabase/functions/_shared/capabilities/registry.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

const baseInput = {
  toolName: RECORD_PROJECT_MEMORY_TOOL_NAME,
  workspaceId: 'workspace-1',
  ownerId: '00000000-0000-0000-0000-000000000001',
  sourceMessageId: 'message-1',
  currentUserText: 'Karar: canlıya geçiş yalnız golden testler yeşil olduktan sonra yapılacak.',
}

describe('trusted Project Memory capability v2', () => {
  it('is a semantic context candidate, not an always-visible meta tool', () => {
    const memoryCapability = CAPABILITY_REGISTRY.find(item => item.toolName === RECORD_PROJECT_MEMORY_TOOL_NAME)
    expect(memoryCapability?.category).toBe('context')
    expect(memoryCapability?.metadata.requiresUserProvenance).toBe(true)

    const withoutMemory = buildControllerCapabilitySurface([])
    expect(withoutMemory.toolNames).not.toContain(RECORD_PROJECT_MEMORY_TOOL_NAME)

    const withMemory = buildControllerCapabilitySurface([{
      id: memoryCapability!.id,
      kind: memoryCapability!.kind,
      category: memoryCapability!.category,
      title: memoryCapability!.title,
      description: memoryCapability!.description,
      toolName: memoryCapability!.toolName,
      score: 0.9,
      semanticScore: 0.9,
      lexicalScore: 0,
      registryVersion: 'capability-registry-v2',
      discoveryVersion: 'capability-discovery-v2',
    }])
    expect(withMemory.toolNames).toContain(RECORD_PROJECT_MEMORY_TOOL_NAME)
  })

  it('rejects a model-invented quote before any database write', async () => {
    const rpc = vi.fn()
    await expect(executeContextTool({
      ...baseInput,
      client: { rpc },
      args: {
        memoryClass: 'DECISION',
        memoryKey: 'rollout_gate',
        value: 'Production only after golden tests pass.',
        correctionTarget: null,
        sourceQuote: 'Kullanıcı production hemen açılsın dedi.',
      },
    })).rejects.toThrow('MEMORY_SOURCE_QUOTE_NOT_IN_CURRENT_USER_MESSAGE')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('supplies owner/workspace/message identity from runtime and stores only an exact user-backed decision', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'memory-id-1', error: null })
    const sourceQuote = 'canlıya geçiş yalnız golden testler yeşil olduktan sonra yapılacak'
    const result = await executeContextTool({
      ...baseInput,
      client: { rpc },
      args: {
        memoryClass: 'DECISION',
        memoryKey: 'rollout_gate',
        value: 'Canlıya geçiş golden testlerden sonra.',
        correctionTarget: null,
        sourceQuote,
      },
    })

    expect(rpc).toHaveBeenCalledWith('persist_agent_project_memory_from_user_quote_v2', expect.objectContaining({
      p_workspace_id: baseInput.workspaceId,
      p_owner_id: baseInput.ownerId,
      p_source_message_id: baseInput.sourceMessageId,
      p_source_quote: sourceQuote,
      p_memory_key: 'rollout_gate',
      p_category: 'decision',
    }))
    expect(result.summary.provenanceVerifiedByRuntime).toBe(true)
    expect(result.summary.provenanceVerifiedByDatabase).toBe(true)
  })

  it('database contract re-validates workspace, role=user and exact quote', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20260902173500_harden_agent_project_memory_quote_provenance.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain("message_row.workspace_id = p_workspace_id")
    expect(migration).toContain("message_row.role = 'user'")
    expect(migration).toContain('position(v_quote in v_message_text) = 0')
    expect(migration).toContain("source_type,\n    confirmation_state,\n    confidence")
    expect(migration).toContain("'user_message',\n    'confirmed',\n    1")
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('supersedes_id')
  })
})
