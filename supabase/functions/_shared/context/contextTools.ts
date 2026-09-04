import { createEvidenceControllerSession } from '../evidence/controllerSession.ts'
import type {
  ControllerConflictProposal,
  ControllerCoverageProposal,
} from '../evidence/runtimeLedger.ts'

export const CONTEXT_TOOLS_VERSION = 'agent-context-tools-v2'
export const REVIEW_EVIDENCE_COVERAGE_TOOL_NAME = 'review_evidence_coverage'

export const ASSISTANT_CONTEXT_TOOLS = [
  {
    type: 'function',
    name: 'record_project_memory',
    description: 'Persist one durable user-owned project fact, decision, or correction when it will materially help future turns. Use only for facts/decisions the user actually stated. sourceQuote must be an exact quote copied from a real user message in this workspace; the database verifies it. Never use this for assistant hypotheses, inferred technical facts, temporary progress, secrets, or evidence retrieved from tools. The runtime/database derives owner and source message identity; you cannot provide them.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        memoryClass: { type: 'string', enum: ['DECISION', 'PROJECT_FACT', 'CORRECTION'] },
        category: { type: 'string', enum: ['decision', 'fact'] },
        memoryKey: { type: 'string', minLength: 1, maxLength: 240 },
        value: { type: 'string', minLength: 1, maxLength: 2_000 },
        sourceQuote: { type: 'string', minLength: 4, maxLength: 1_000 },
      },
      required: ['memoryClass', 'category', 'memoryKey', 'value', 'sourceQuote'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
    description: 'Inspect and review the mechanically verified evidence accumulated in the current running turn. Call with aspects=[] and conflicts=[] to read current evidence IDs. Then, if useful, call again with your semantic aspect-to-evidence and conflict proposals. Runtime validates IDs and returns coverage/gap/conflict critic observations. This tool does not search, select the next capability, or finalize the answer.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        aspects: {
          type: 'array',
          minItems: 0,
          maxItems: 32,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 160 },
              label: { type: 'string', minLength: 1, maxLength: 500 },
              evidenceIds: {
                type: 'array',
                maxItems: 24,
                items: { type: 'string', minLength: 1, maxLength: 160 },
              },
              status: { type: 'string', enum: ['covered', 'partial', 'open'] },
            },
            required: ['id', 'label', 'evidenceIds', 'status'],
            additionalProperties: false,
          },
        },
        conflicts: {
          type: 'array',
          minItems: 0,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', minLength: 1, maxLength: 240 },
              evidenceIds: {
                type: 'array',
                minItems: 2,
                maxItems: 24,
                items: { type: 'string', minLength: 1, maxLength: 160 },
              },
            },
            required: ['key', 'evidenceIds'],
            additionalProperties: false,
          },
        },
      },
      required: ['aspects', 'conflicts'],
      additionalProperties: false,
    },
  },
] as const

const TOOL_NAMES = new Set(ASSISTANT_CONTEXT_TOOLS.map(tool => tool.name))
export const isContextTool = (toolName: string) => TOOL_NAMES.has(toolName as never)
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export interface ContextToolExecution {
  output: string
  sources: []
  summary: Record<string, unknown>
}

const cleanCoverageProposal = (value: unknown): ControllerCoverageProposal => {
  const rows = Array.isArray(value) ? value.slice(0, 32) : []
  return {
    aspects: rows.flatMap(raw => {
      if (!raw || typeof raw !== 'object') return []
      const row = raw as Record<string, unknown>
      const id = clean(row.id, 160)
      const label = clean(row.label, 500)
      const status = ['covered', 'partial', 'open'].includes(String(row.status))
        ? String(row.status) as 'covered' | 'partial' | 'open'
        : 'open'
      if (!id || !label) return []
      return [{
        id,
        label,
        status,
        evidenceIds: Array.isArray(row.evidenceIds)
          ? [...new Set(row.evidenceIds.map(item => clean(item, 160)).filter(Boolean))].slice(0, 24)
          : [],
      }]
    }),
  }
}

const cleanConflictProposal = (value: unknown): ControllerConflictProposal => {
  const rows = Array.isArray(value) ? value.slice(0, 16) : []
  return {
    conflicts: rows.flatMap(raw => {
      if (!raw || typeof raw !== 'object') return []
      const row = raw as Record<string, unknown>
      const key = clean(row.key, 240)
      const evidenceIds = Array.isArray(row.evidenceIds)
        ? [...new Set(row.evidenceIds.map(item => clean(item, 160)).filter(Boolean))].slice(0, 24)
        : []
      if (!key || evidenceIds.length < 2) return []
      return [{ key, evidenceIds }]
    }),
  }
}

async function executeEvidenceReviewTool(input: {
  client: any
  workspaceId: string
  args: Record<string, unknown>
}): Promise<ContextToolExecution> {
  const { data, error } = await input.client.rpc('get_current_agent_evidence_sources_v2', {
    p_workspace_id: input.workspaceId,
  })
  if (error) throw new Error(clean(error.message, 1_000) || 'Current-turn evidence read failed.')

  const session = createEvidenceControllerSession('Current user question')
  for (const raw of Array.isArray(data) ? data : []) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const toolName = clean(row.tool_name, 120)
    const resultSummary = row.result_summary && typeof row.result_summary === 'object'
      ? row.result_summary as Record<string, unknown>
      : {}
    const sourceRefs = Array.isArray(row.source_refs)
      ? row.source_refs.filter(source => source && typeof source === 'object') as Array<Record<string, unknown>>
      : []

    if (toolName === 'web_search' || toolName === 'gemini_google_search') {
      session.recordWebSources(sourceRefs.map(source => ({ ...source, sourceType: 'web' })) as any)
      continue
    }

    session.recordToolResult({
      output: '',
      records: [],
      sources: sourceRefs as any,
      summary: resultSummary,
    } as any)
  }

  const coverageProposal = cleanCoverageProposal(input.args.aspects)
  if (coverageProposal.aspects.length) session.applyCoverageProposal(coverageProposal)
  const conflictProposal = cleanConflictProposal(input.args.conflicts)
  if (conflictProposal.conflicts.length) session.applyConflictProposal(conflictProposal)
  const observation = session.observation()

  return {
    output: JSON.stringify({
      securityNotice: 'JETWORK_EVIDENCE_REVIEW_OBSERVATION. Evidence refs come only from the authenticated user current running turn. Coverage/conflicts are controller proposals constrained to those verified refs. The critic never chooses a tool or finalizes the answer.',
      tool: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
      ...observation,
    }),
    sources: [],
    summary: {
      contextObservation: true,
      evidenceReview: true,
      citationReady: false,
      evidenceCount: observation.evidence.length,
      aspectCount: observation.aspects.length,
      coverage: observation.critic.coverage,
      gapCount: observation.critic.gaps.length,
      conflictCount: observation.critic.conflicts.length,
      controllerDecisionRequired: true,
    },
  }
}

export async function executeContextTool(input: {
  client: any
  workspaceId: string
  toolName: string
  args: Record<string, unknown>
}): Promise<ContextToolExecution> {
  if (!isContextTool(input.toolName)) throw new Error(`Unknown context tool: ${input.toolName}`)
  if (input.toolName === REVIEW_EVIDENCE_COVERAGE_TOOL_NAME) {
    return executeEvidenceReviewTool(input)
  }

  const memoryClass = clean(input.args.memoryClass, 40).toUpperCase()
  const category = clean(input.args.category, 20).toLowerCase()
  const memoryKey = clean(input.args.memoryKey, 240)
  const value = clean(input.args.value, 2_000)
  const sourceQuote = clean(input.args.sourceQuote, 1_000)

  if (!['DECISION', 'PROJECT_FACT', 'CORRECTION'].includes(memoryClass)) throw new Error('Invalid durable memory class.')
  if (!['decision', 'fact'].includes(category)) throw new Error('Invalid durable memory category.')
  if (!memoryKey || !value || sourceQuote.length < 4) throw new Error('memoryKey, value and an exact sourceQuote are required.')

  const { data, error } = await input.client.rpc('record_agent_project_memory_v2', {
    p_workspace_id: input.workspaceId,
    p_memory_key: memoryKey,
    p_value: value,
    p_memory_class: memoryClass,
    p_category: category,
    p_source_quote: sourceQuote,
  })
  if (error) throw new Error(clean(error.message, 1_000) || 'Project Memory write failed.')

  const memoryId = clean(data, 200)
  return {
    output: JSON.stringify({
      securityNotice: 'JETWORK_CONTEXT_WRITE_RESULT. This is a persistence result, not enterprise evidence or a citation.',
      tool: input.toolName,
      saved: Boolean(memoryId),
      memoryId: memoryId || null,
      memoryKey,
      memoryClass,
      category,
    }),
    sources: [],
    summary: {
      contextWrite: true,
      durableMemory: true,
      citationReady: false,
      userProvenanceRequired: true,
      memoryId: memoryId || null,
      memoryKey,
      memoryClass,
      category,
    },
  }
}
