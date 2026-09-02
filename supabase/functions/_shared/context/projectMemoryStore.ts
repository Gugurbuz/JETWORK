import {
  durableProjectMemoryCandidates,
  type StateUpdateCandidate,
} from './stateReducer.ts'

export const PROJECT_MEMORY_STORE_VERSION = 'agent-project-memory-store-v2'

interface RpcResult {
  data?: unknown
  error?: { message?: string } | null
}

export interface ProjectMemoryRpcClient {
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>
}

export interface ProjectMemoryWriteRequest {
  workspaceId: string
  ownerId: string
  memoryKey: string
  value: string
  category: 'fact' | 'decision'
  sourceMessageId: string | null
  validFrom: string | null
}

export interface ProjectMemoryStoreResult {
  ok: boolean
  attemptedCount: number
  savedCount: number
  skippedCount: number
  savedIds: string[]
  error?: string
}

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

const categoryFor = (candidate: StateUpdateCandidate): 'fact' | 'decision' => {
  if (candidate.class === 'DECISION') return 'decision'
  if (candidate.class === 'CORRECTION' && candidate.correctionTarget === 'decision') return 'decision'
  return 'fact'
}

/**
 * Converts only already-trusted structured state events into mechanical DB
 * requests. Raw chat text is intentionally not accepted by this module.
 */
export const buildProjectMemoryWriteRequests = (input: {
  workspaceId: string
  ownerId: string
  sourceMessageId?: string | null
  candidates: readonly StateUpdateCandidate[]
}): ProjectMemoryWriteRequest[] => {
  const workspaceId = clean(input.workspaceId, 200)
  const ownerId = clean(input.ownerId, 200)
  if (!workspaceId || !ownerId) return []

  return durableProjectMemoryCandidates(input.candidates).map(candidate => ({
    workspaceId,
    ownerId,
    memoryKey: clean(candidate.key, 240),
    value: clean(candidate.value, 2_000),
    category: categoryFor(candidate),
    sourceMessageId: clean(input.sourceMessageId, 240) || null,
    validFrom: clean(candidate.updatedAt, 80) || null,
  }))
}

export async function persistProjectMemoryCandidatesV2(input: {
  client: ProjectMemoryRpcClient
  workspaceId: string
  ownerId: string
  sourceMessageId?: string | null
  candidates: readonly StateUpdateCandidate[]
}): Promise<ProjectMemoryStoreResult> {
  const requests = buildProjectMemoryWriteRequests(input)
  const skippedCount = Math.max(0, input.candidates.length - requests.length)
  if (!requests.length) {
    return {
      ok: true,
      attemptedCount: 0,
      savedCount: 0,
      skippedCount,
      savedIds: [],
    }
  }

  const savedIds: string[] = []
  for (const request of requests) {
    const { data, error } = await input.client.rpc('persist_agent_project_memory_v2', {
      p_workspace_id: request.workspaceId,
      p_owner_id: request.ownerId,
      p_memory_key: request.memoryKey,
      p_value: request.value,
      p_category: request.category,
      p_source_message_id: request.sourceMessageId,
      p_valid_from: request.validFrom,
    })
    if (error) {
      return {
        ok: false,
        attemptedCount: requests.length,
        savedCount: savedIds.length,
        skippedCount,
        savedIds,
        error: clean(error.message, 1_000) || 'Project Memory persistence failed.',
      }
    }
    const id = clean(data, 200)
    if (id) savedIds.push(id)
  }

  return {
    ok: true,
    attemptedCount: requests.length,
    savedCount: savedIds.length,
    skippedCount,
    savedIds,
  }
}
