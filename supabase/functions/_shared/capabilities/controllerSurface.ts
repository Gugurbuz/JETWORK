import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_SKILL_TOOLS } from '../skillTools.ts'
import {
  ASSISTANT_CONTEXT_TOOLS,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../context/contextTools.ts'
import {
  buildCapabilityIndex,
  capabilityIndexText,
  INVOKE_CAPABILITY_TOOL,
  INVOKE_CAPABILITY_TOOL_NAME,
  LOAD_CAPABILITY_CONTRACT_TOOL,
  LOAD_CAPABILITY_CONTRACT_TOOL_NAME,
  LOAD_CAPABILITY_GUIDE_TOOL,
  LOAD_CAPABILITY_GUIDE_TOOL_NAME,
  type CapabilityIndexEntry,
} from './progressiveDisclosure.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v5-progressive-disclosure'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const REPORT_PROGRESS_TOOL_NAME = 'report_progress'
export const REQUEST_LARGE_CONTEXT_TOOL_NAME = 'request_large_context'
export {
  INVOKE_CAPABILITY_TOOL_NAME,
  LOAD_CAPABILITY_CONTRACT_TOOL_NAME,
  LOAD_CAPABILITY_GUIDE_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
}

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

// Logical surface remains the complete JetWork capability set. Physical provider
// schemas are intentionally smaller and only expose lifecycle + progressive
// disclosure mechanics; the active Controller still sees every logical option in
// the Layer-1 index and decides what (if anything) to inspect or invoke.
const logicalTools = uniqueTools([
  REPORT_PROGRESS_TOOL,
  ...runtimeTools,
  REQUEST_LARGE_CONTEXT_TOOL,
])

export const CONTROLLER_LOGICAL_CAPABILITY_TOOLS: readonly RuntimeToolSchema[] = logicalTools
export const CONTROLLER_CAPABILITY_INDEX: readonly CapabilityIndexEntry[] = buildCapabilityIndex(logicalTools)

/** Compatibility declaration only; no longer model-visible in V5. */
export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  description: 'Legacy compatibility tool. Controller V5 receives a compact Layer-1 catalog and progressively loads guides/contracts instead.',
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
  logicalToolNames: string[]
  capabilityIndex: readonly CapabilityIndexEntry[]
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
  discoveryMode: 'progressive_disclosure'
  fallbackReason?: string
  seenCandidateIds: string[]
  surface: ControllerCapabilitySurface
}

export const buildControllerCapabilitySurface = (_legacyCandidates?: readonly unknown[]): ControllerCapabilitySurface => {
  const tools = uniqueTools([
    REPORT_PROGRESS_TOOL,
    LOAD_CAPABILITY_GUIDE_TOOL,
    LOAD_CAPABILITY_CONTRACT_TOOL,
    INVOKE_CAPABILITY_TOOL,
    // Large-context retrieval is a controller-context primitive rather than a
    // domain capability, so it stays directly callable and does not require a
    // three-round disclosure ceremony.
    REQUEST_LARGE_CONTEXT_TOOL,
  ])

  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    tools,
    providerWebVisible: true,
    candidateIds: [],
    toolNames: tools.map(tool => tool.name),
    logicalToolNames: logicalTools.map(tool => tool.name),
    capabilityIndex: CONTROLLER_CAPABILITY_INDEX,
    skillKeys: [],
    candidates: [],
  }
}

export async function startControllerCapabilitySession(_input: {
  client: any
  geminiApiKey?: string
  query: unknown
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    discoveryMode: 'progressive_disclosure',
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
  logicalCapabilityCount: session.surface.logicalToolNames.length,
  capabilityIndex: capabilityIndexText(CONTROLLER_LOGICAL_CAPABILITY_TOOLS),
  visibleTransportTools: session.surface.toolNames,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'Layer-1 katalogdaki tüm capabilityler semantic seçenektir, route değildir. Tool-backed işte public start sonrası ciddi adayların Layer-2 guide’ını, sonra hâlâ uygunsa Layer-3 exact contract’ını oku; contract sonrası nihai kararın hâlâ evetse invoke_capability çağır. Runtime capability, sorgu veya sonraki adımı seçmez; her observation sonrası aynı Controller yeniden karar verir.',
})