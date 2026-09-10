import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_SKILL_TOOLS } from '../skillTools.ts'
import {
  ASSISTANT_CONTEXT_TOOLS,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../context/contextTools.ts'
import {
  CAPABILITY_DISCLOSURE_VERSION,
  JETWORK_CAPABILITY_INDEX,
  JETWORK_LOGICAL_CAPABILITY_NAMES,
  capabilityIndexEntry,
  compactCapabilityIndex,
} from './progressiveDisclosure.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v5.3-semantic-action-batch'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const EXECUTE_CAPABILITIES_TOOL_NAME = 'execute_capabilities'
export const REPORT_PROGRESS_TOOL_NAME = 'report_progress'
export const REQUEST_LARGE_CONTEXT_TOOL_NAME = 'request_large_context'
export { REVIEW_EVIDENCE_COVERAGE_TOOL_NAME }

const MAX_DISCLOSURE_SELECTION = 4
const MAX_ACTIVATED_CAPABILITIES = 8

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

const canonicalRuntimeTools = [
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

export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  description: 'Progressively inspect JetWork capabilities without giving semantic authority to runtime. Normal low-latency path: use query="index" once to load Layer-1 capability names and purpose summaries, choose up to four exact names yourself, then use query="activate:name1,name2" to receive their Layer-2 usage guides and mechanically activate their exact canonical schemas together for the next model round. Legacy query="guide:name1,name2" then query="contract:name1,name2" remains compatibility-only. Runtime validates exact names and disclosure order only; it never chooses capabilities for you.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 2_000 },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 4 },
    },
    required: ['query', 'limit'],
    additionalProperties: false,
  },
}

const canonicalTools = uniqueTools([
  REPORT_PROGRESS_TOOL,
  ...canonicalRuntimeTools,
  REQUEST_LARGE_CONTEXT_TOOL,
])
const canonicalByName = new Map(canonicalTools.map(tool => [tool.name, tool]))
const progressivelyDisclosableNames = new Set(
  canonicalTools
    .map(tool => tool.name)
    .filter(name => ![REPORT_PROGRESS_TOOL_NAME, REQUEST_LARGE_CONTEXT_TOOL_NAME].includes(name)),
)

if (canonicalTools.length !== JETWORK_LOGICAL_CAPABILITY_NAMES.length) {
  console.warn('JETWORK_CAPABILITY_INDEX_COUNT_MISMATCH', JSON.stringify({
    canonical: canonicalTools.map(tool => tool.name),
    indexed: JETWORK_LOGICAL_CAPABILITY_NAMES,
  }))
}

export const getCanonicalCapabilityTool = (name: string): RuntimeToolSchema | null => {
  const tool = canonicalByName.get(name)
  return tool ? { ...tool, parameters: tool.parameters ? structuredClone(tool.parameters) : tool.parameters } : null
}

const executionCapabilityNames = JETWORK_LOGICAL_CAPABILITY_NAMES.filter(
  name => ![REPORT_PROGRESS_TOOL_NAME, REQUEST_LARGE_CONTEXT_TOOL_NAME].includes(name),
)

const requiredArgumentNames = (tool: RuntimeToolSchema | null): string[] => {
  const required = tool?.parameters && typeof tool.parameters === 'object'
    ? (tool.parameters as Record<string, unknown>).required
    : null
  return Array.isArray(required) ? required.map(value => String(value)).filter(Boolean) : []
}

const compactExecutionMenu = () => executionCapabilityNames.map(name => {
  const entry = capabilityIndexEntry(name)
  const required = requiredArgumentNames(getCanonicalCapabilityTool(name))
  const signature = required.length ? `${name}(${required.join(', ')})` : `${name}()`
  return `${signature} — ${entry?.summary || 'JetWork capability'}`
}).join('\n')

export const buildExecuteCapabilitiesTool = (): RuntimeToolSchema => ({
  type: 'function',
  name: EXECUTE_CAPABILITIES_TOOL_NAME,
  description: [
    'Execute a model-authored batch of JetWork capabilities through one mechanical runtime boundary.',
    'The active Controller model is the sole semantic authority: it chooses every capability name, every argument and whether more work is needed.',
    'Runtime only validates exact capability names and canonical argument contracts, enforces permissions/budgets, executes the requested actions, preserves provenance and returns observations.',
    'Batch only actions whose arguments are fully known from the current observation and that do not depend on another action in this same batch. If an action needs an identifier or value produced by another action, wait for the next Controller round.',
    'Use one action for a single capability; use multiple actions to avoid needless model round-trips when they are independently justified.',
    'Compact capability menu (required argument names only):',
    compactExecutionMenu(),
  ].join('\n'),
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 80 },
            capability: { type: 'string', enum: executionCapabilityNames },
            argumentsJson: { type: 'string', minLength: 2, maxLength: 12_000 },
          },
          required: ['id', 'capability', 'argumentsJson'],
          additionalProperties: false,
        },
      },
    },
    required: ['actions'],
    additionalProperties: false,
  },
})

export interface ControllerCapabilitySurface {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  tools: RuntimeToolSchema[]
  providerWebVisible: boolean
  candidateIds: string[]
  toolNames: string[]
  logicalToolNames: string[]
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

type CapabilityDisclosure =
  | { layer: 'ready'; records: [] }
  | { layer: 'index'; records: ReturnType<typeof compactCapabilityIndex> }
  | { layer: 'guide'; records: Array<{ name: string; category: string; summary: string; guide: string }> }
  | { layer: 'contract'; records: Array<{ name: string; activated: true }> }
  | { layer: 'activated'; records: Array<{ name: string; category: string; summary: string; guide: string; activated: true }> }
  | { layer: 'error'; records: []; message: string }

export interface ControllerCapabilitySession {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  discoveryMode: 'progressive_disclosure'
  fallbackReason?: string
  seenCandidateIds: string[]
  guidedToolNames: string[]
  activatedToolNames: string[]
  lastDisclosure: CapabilityDisclosure
  surface: ControllerCapabilitySurface
}

const basePhysicalTools = () => uniqueTools([
  REPORT_PROGRESS_TOOL,
  buildExecuteCapabilitiesTool(),
  REQUEST_LARGE_CONTEXT_TOOL,
])

const surfaceWithActivated = (activatedToolNames: readonly string[]): ControllerCapabilitySurface => {
  const activated = activatedToolNames
    .map(name => getCanonicalCapabilityTool(name))
    .filter((tool): tool is RuntimeToolSchema => Boolean(tool))
  const tools = uniqueTools([...basePhysicalTools(), ...activated])
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    tools,
    providerWebVisible: false,
    candidateIds: [],
    toolNames: tools.map(tool => tool.name),
    logicalToolNames: canonicalTools.map(tool => tool.name),
    skillKeys: [],
    candidates: [],
  }
}

export const buildControllerCapabilitySurface = (_legacyCandidates?: readonly unknown[]): ControllerCapabilitySurface => (
  surfaceWithActivated([])
)

export async function startControllerCapabilitySession(_input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    discoveryMode: 'progressive_disclosure',
    seenCandidateIds: [],
    guidedToolNames: [],
    activatedToolNames: [],
    lastDisclosure: { layer: 'ready', records: [] },
    surface: buildControllerCapabilitySurface(),
  }
}

const parseExactNames = (raw: string, limit: number) => {
  const names = [...new Set(raw.split(/[\n,]/u).map(name => name.trim()).filter(Boolean))].slice(0, limit)
  return names.filter(name => progressivelyDisclosableNames.has(name))
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  const query = String(input.query || '').trim()
  const requestedLimit = Math.max(1, Math.min(Number(input.limit || MAX_DISCLOSURE_SELECTION), MAX_DISCLOSURE_SELECTION))

  if (query.toLocaleLowerCase('en-US') === 'index') {
    return {
      ...input.session,
      lastDisclosure: { layer: 'index', records: compactCapabilityIndex() },
    }
  }

  const activateMatch = query.match(/^activate\s*:(.*)$/isu)
  if (activateMatch) {
    const requested = parseExactNames(activateMatch[1], requestedLimit)
    if (!requested.length) {
      return { ...input.session, lastDisclosure: { layer: 'error', records: [], message: 'No exact capability names from Layer-1 index were supplied.' } }
    }
    const records = requested.flatMap(name => {
      const entry = capabilityIndexEntry(name)
      return entry ? [{ name, category: entry.category, summary: entry.summary, guide: entry.guide, activated: true as const }] : []
    })
    const activatedToolNames = [...new Set([...input.session.activatedToolNames, ...records.map(record => record.name)])].slice(0, MAX_ACTIVATED_CAPABILITIES)
    return {
      ...input.session,
      guidedToolNames: [...new Set([...input.session.guidedToolNames, ...records.map(record => record.name)])],
      activatedToolNames,
      surface: surfaceWithActivated(activatedToolNames),
      lastDisclosure: { layer: 'activated', records },
    }
  }

  const guideMatch = query.match(/^guide\s*:(.*)$/isu)
  if (guideMatch) {
    const requested = parseExactNames(guideMatch[1], requestedLimit)
    if (!requested.length) {
      return { ...input.session, lastDisclosure: { layer: 'error', records: [], message: 'No exact capability names from Layer-1 index were supplied.' } }
    }
    const records = requested.flatMap(name => {
      const entry = capabilityIndexEntry(name)
      return entry ? [{ name, category: entry.category, summary: entry.summary, guide: entry.guide }] : []
    })
    return {
      ...input.session,
      guidedToolNames: [...new Set([...input.session.guidedToolNames, ...records.map(record => record.name)])],
      lastDisclosure: { layer: 'guide', records },
    }
  }

  const contractMatch = query.match(/^contract\s*:(.*)$/isu)
  if (contractMatch) {
    const requested = parseExactNames(contractMatch[1], requestedLimit)
    const guided = new Set(input.session.guidedToolNames)
    const eligible = requested.filter(name => guided.has(name))
    if (!eligible.length || eligible.length !== requested.length) {
      return { ...input.session, lastDisclosure: { layer: 'error', records: [], message: 'Layer-3 contract activation requires the same exact capability names to have been loaded through Layer-2 guide first.' } }
    }
    const activatedToolNames = [...new Set([...input.session.activatedToolNames, ...eligible])].slice(0, MAX_ACTIVATED_CAPABILITIES)
    return {
      ...input.session,
      activatedToolNames,
      surface: surfaceWithActivated(activatedToolNames),
      lastDisclosure: { layer: 'contract', records: eligible.map(name => ({ name, activated: true as const })) },
    }
  }

  return {
    ...input.session,
    lastDisclosure: {
      layer: 'error',
      records: [],
      message: 'Use a progressive disclosure command: index, activate:<exact capability names>, or the legacy guide:<names> / contract:<names> sequence.',
    },
  }
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => ({
  version: session.version,
  disclosureVersion: CAPABILITY_DISCLOSURE_VERSION,
  discoveryMode: session.discoveryMode,
  candidates: [],
  visibleToolNames: session.surface.toolNames,
  logicalCapabilityCount: session.surface.logicalToolNames.length,
  guidedToolNames: session.guidedToolNames,
  activatedToolNames: session.activatedToolNames,
  disclosure: session.lastDisclosure,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'JetWork V5.3 uses semantic action batching. The active model remains the sole semantic Controller. If no external capability is needed, answer directly. For substantive work, report_progress(start) must precede execute_capabilities; both may be emitted in the same model response in that order. choose capability names and arguments yourself from the compact menu exposed by execute_capabilities. Batch independent actions whose arguments are already known. When an action depends on a value discovered by a previous action, wait for the observation and use the next model round. Runtime only validates name/schema/permission/budget and executes; it never infers intent, selects a tool, rewrites a query, chooses a source, or decides when to stop. Legacy progressive-disclosure helpers remain implementation compatibility only and are not part of the normal physical surface.',
})

// Keep registry construction eager so drift between the 33 logical entries and canonical runtime is visible in tests/logs.
void JETWORK_CAPABILITY_INDEX
