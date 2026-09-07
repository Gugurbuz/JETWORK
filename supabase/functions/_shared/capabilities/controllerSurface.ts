import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_SKILL_TOOLS } from '../skillTools.ts'
import {
  ASSISTANT_CONTEXT_TOOLS,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../context/contextTools.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v3-full'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const REPORT_PROGRESS_TOOL_NAME = 'report_progress'
export const REQUEST_LARGE_CONTEXT_TOOL_NAME = 'request_large_context'
export { REVIEW_EVIDENCE_COVERAGE_TOOL_NAME }

const runtimeTools = [
  ...(ASSISTANT_SKILL_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_KNOWLEDGE_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_CONTEXT_TOOLS as unknown as RuntimeToolSchema[]),
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
  description: 'Publishes a short user-visible Agent Work update. It has no retrieval, planning, permission or execution authority.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['start', 'finding', 'plan_change', 'blocked'] },
      message: { type: 'string', minLength: 2, maxLength: 500 },
      sourceRefs: { type: ['array', 'null'], items: { type: 'string', maxLength: 500 }, maxItems: 8 },
    },
    required: ['kind', 'message', 'sourceRefs'],
    additionalProperties: false,
  },
}

/**
 * Compatibility declaration only.
 *
 * Controller V3 exposes the complete JetWork capability surface up front, so
 * semantic Top-K discovery is no longer part of the active controller path.
 * The old tool name stays exported while callers/tests are migrated, but it is
 * deliberately not included in the model-visible surface.
 */
export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  description: 'Legacy compatibility tool. Controller V3 already receives the complete capability surface.',
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
  // The model sees every registered JetWork tool. Runtime does not pre-select a
  // subset from the user's text and does not append per-tool workflow guidance.
  const tools = uniqueTools([
    ...runtimeTools,
    REPORT_PROGRESS_TOOL,
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
  // V3 has no semantic capability pagination. Return the same full surface for
  // compatibility with a stale in-flight caller that still invokes this path.
  return input.session
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => ({
  version: session.version,
  discoveryMode: session.discoveryMode,
  candidates: [],
  visibleToolNames: session.surface.toolNames,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'All registered JetWork capabilities are visible. Capability choice, retrieval strategy, query formulation, follow-up actions and stop/final decisions belong to the controller model. Runtime supplies execution and mechanical safety only.',
})
