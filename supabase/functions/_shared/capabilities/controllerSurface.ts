import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_SKILL_TOOLS } from '../skillTools.ts'
import {
  ASSISTANT_CONTEXT_TOOLS,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../context/contextTools.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v4-public-work-plan'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const REPORT_PROGRESS_TOOL_NAME = 'report_progress'
export const REQUEST_LARGE_CONTEXT_TOOL_NAME = 'request_large_context'
export { REVIEW_EVIDENCE_COVERAGE_TOOL_NAME }

const withControllerRetrievalContract = (raw: RuntimeToolSchema): RuntimeToolSchema => {
  const tool = { ...raw }
  if (tool.name === 'search_knowledge_catalog' || tool.name === 'search_document') {
    tool.description = `${String(tool.description || '').trim()} This is ranked candidate discovery, not exhaustive enumeration. Prefer one semantically complete query that keeps jointly meaningful user terms together. If a strong candidate is found, deepen that candidate with an exact/detail/source capability instead of repeatedly broadening the search. A zero-result candidate search is an observation, not proof that the requested enterprise concept does not exist.`
  }
  if (tool.name === 'list_knowledge_catalog' || tool.name === 'list_class_inventory') {
    tool.description = `${String(tool.description || '').trim()} This is an enumeration capability for genuine list/inventory/coverage needs, not a fallback for a failed exact search. A nextCursor only means more records exist; it is never an instruction to fetch the next page. Request another page only when the current user goal materially requires broader coverage.`
  }
  if (['get_abap_source','get_message_detail','get_document_content','get_knowledge_object','get_knowledge_objects','get_related_objects'].includes(tool.name)) {
    tool.description = `${String(tool.description || '').trim()} Use this to deepen a known candidate when the remaining evidence gap requires exact/detail/source/relation evidence.`
  }
  return tool
}

// Evidence/source tools remain semantically neutral options. The public work tool
// is intentionally first because it is a lifecycle/control capability rather than
// a semantic route: if the model decides to do substantive tool work, it must first
// publish its own resolved goal and plan. The runtime still never chooses the domain,
// query, source, next tool or stop decision for the model.
const runtimeTools = [
  ...(ASSISTANT_KNOWLEDGE_TOOLS as unknown as RuntimeToolSchema[]).map(withControllerRetrievalContract),
  ...(ASSISTANT_CONTEXT_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_SKILL_TOOLS as unknown as RuntimeToolSchema[]),
]

const uniqueTools = (tools: RuntimeToolSchema[]) => {
  const seen = new Set<string>()
  return tools.filter(tool => {
    if (!tool?.name || seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

export const REQUEST_LARGE_CONTEXT_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: REQUEST_LARGE_CONTEXT_TOOL_NAME,
  description: 'Returns a larger bounded slice of prior JetWork conversation context. Use only when additional history would materially help the current task.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 4, maxLength: 500 },
      targetCharacters: { type: ['integer', 'null'], minimum: 36_000, maximum: 240_000 },
    },
    required: ['reason', 'targetCharacters'],
    additionalProperties: false,
  },
}

export const REPORT_PROGRESS_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: REPORT_PROGRESS_TOOL_NAME,
  description: 'Publishes a short user-visible Agent Work update and a structured work-state snapshot. It has no retrieval, planning authority, permission or execution authority: the active controller model supplies the resolved goal, plan and evidence gaps itself. If the model decides to use any substantive tool, start must be its first tool call. Use finding for a material verified finding, plan_change when observations materially change the approach, and blocked only for a real blocker. Never expose private chain-of-thought.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['start', 'finding', 'plan_change', 'blocked'] },
      message: { type: 'string', minLength: 2, maxLength: 500 },
      resolvedGoal: { type: ['string', 'null'], minLength: 2, maxLength: 900 },
      planSteps: {
        type: ['array', 'null'],
        items: { type: 'string', minLength: 2, maxLength: 320 },
        minItems: 1,
        maxItems: 8,
      },
      evidenceGaps: {
        type: ['array', 'null'],
        items: { type: 'string', minLength: 2, maxLength: 320 },
        maxItems: 8,
      },
      sourceRefs: { type: ['array', 'null'], items: { type: 'string', maxLength: 500 } },
    },
    required: ['kind', 'message', 'resolvedGoal', 'planSteps', 'evidenceGaps', 'sourceRefs'],
    additionalProperties: false,
  },
}

/**
 * Compatibility declaration only.
 *
 * Controller V4 exposes the complete JetWork semantic capability surface after
 * the public work-start gate. The old discovery tool name stays exported while
 * stale callers/tests are migrated, but it is deliberately not included in the model-visible surface.
 */
export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  description: 'Legacy compatibility tool. Controller V4 already receives the complete capability surface after the public work-start gate.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 2_000 },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 64 },
    },
    required: ['query', 'limit'],
    additionalProperties: false,
  },
}

export interface ControllerCapabilitySurface {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  tools: RuntimeToolSchema[]
  providerWebVisible: boolean
  candidateIds: string[]
  toolNames: string[]
  skillKeys: string[]
  candidates: Array<{
    id: string
    kind: string
    category: string
    title: string
    toolName?: string
    skillKey?: string
    declaredTools?: string[]
    executorTools?: string[]
    score: number
  }>
}

export interface ControllerCapabilitySession {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  discoveryMode: 'full_surface'
  fallbackReason?: string
  seenCandidateIds: string[]
  surface: ControllerCapabilitySurface
}

export const buildControllerCapabilitySurface = (_legacyCandidates?: readonly unknown[]): ControllerCapabilitySurface => {
  const tools = uniqueTools([
    REPORT_PROGRESS_TOOL,
    ...runtimeTools,
    REQUEST_LARGE_CONTEXT_TOOL,
  ])

  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    tools,
    providerWebVisible: true,
    candidateIds: [],
    toolNames: tools.map(tool => tool.name),
    skillKeys: [],
    candidates: [],
  }
}

export async function startControllerCapabilitySession(_input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    discoveryMode: 'full_surface',
    seenCandidateIds: [],
    surface: buildControllerCapabilitySurface(),
  }
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  return input.session
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => ({
  version: session.version,
  discoveryMode: session.discoveryMode,
  candidates: [],
  visibleToolNames: session.surface.toolNames,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'All registered JetWork capabilities are semantic options after the public work-start lifecycle gate. Knowledge tools access enterprise evidence directly. Candidate search, exact/detail retrieval and enumeration are distinct capability types: nextCursor only signals availability and never mandates pagination. A zero-result candidate search is not proof of absence. Public-web discovery is available both as provider-native web when healthy and as the search_web custom discovery capability; url_context can inspect concrete URLs. Provider availability handling is mechanical and never chooses a query or source. Skill/capability discovery returns procedural metadata only and is never evidence or a substitute for a requested source. Capability choice, retrieval strategy, query formulation, follow-up actions, evidence-gap evaluation and stop/final decisions belong to the controller model. Runtime supplies lifecycle, execution and mechanical safety only.',
})