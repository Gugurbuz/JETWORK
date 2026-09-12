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
import { discoverIndexedCapabilities } from './indexedDiscovery.ts'
import { discoverCapabilityCandidates } from './discovery.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v5.3-semantic-action-batch'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const EXECUTE_CAPABILITIES_TOOL_NAME = 'execute_capabilities'
export const REPORT_PROGRESS_TOOL_NAME = 'report_progress'
export const REQUEST_LARGE_CONTEXT_TOOL_NAME = 'request_large_context'
export const REQUEST_OBSERVATION_CONTENT_TOOL_NAME = 'request_observation_content'
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
  if (tool.name === 'get_message_detail') {
    tool.description = `${String(tool.description || '').trim()} When available, the verified record also includes bounded directRelations/relatedObjects structural hints. Reuse those canonical hints instead of rediscovering the same linked objects with another broad search; relation hints do not mean the linked object's source content has been read.`
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

export const REQUEST_OBSERVATION_CONTENT_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: REQUEST_OBSERVATION_CONTENT_TOOL_NAME,
  description: 'Read one transport window from a previously truncated tool observation. This is cursor-continuable, not a total evidence cap: use cursor=null for the first slice, then reuse nextCursor/previousCursor as needed. The model chooses find/slice and whether another window is materially needed; runtime performs no semantic selection. truncated=true alone is not a reason to read raw content: first use structured verifiedSignals, directRelations, relatedObjects, canonical identifiers and excerpts already present in the compact preview.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      observationRef: { type: 'string', minLength: 4, maxLength: 200 },
      mode: { type: 'string', enum: ['find', 'slice'] },
      query: { type: ['string', 'null'], maxLength: 500 },
      cursor: { type: ['string', 'null'], maxLength: 120 },
      offset: { type: ['integer', 'null'], minimum: 0 },
      maxChars: { type: ['integer', 'null'], minimum: 500, maximum: 12_000 },
    },
    required: ['observationRef', 'mode', 'query', 'cursor', 'offset', 'maxChars'],
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
  description: 'Discover a small semantic candidate set of JetWork capabilities for a model-authored need. Pass a natural-language capability need; runtime returns ranked candidates with purpose and required argument names but never selects or executes one. Use index or activate:<names> only when you explicitly need the broader catalog or an exact full contract.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 2_000 },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 8 },
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


const FOUNDATIONAL_EVIDENCE_MENU = [
  'Core evidence capabilities available directly through this batch gateway:',
  '- search_knowledge_catalog(query, limit): find a canonical Jetbase object when its key is not yet known.',
  '- get_knowledge_object(canonicalKey): read one known exact Jetbase object.',
  '- get_knowledge_objects(canonicalKeys): read several known exact objects in one batch.',
  '- get_related_objects(canonicalKey, relationTypes, direction, limit): inspect structural CALLS, EMITS_MESSAGE, READS, WRITES and similar relations for a known object.',
  '- get_knowledge_evidence_pack(canonicalKey, hops, limit): read a bounded 1-2 hop evidence graph around one known object.',
  '- get_message_detail(messageCode): read an exact CRM/ABAP message when its code is known; when available it also returns bounded verified directRelations/relatedObjects hints so linked canonical objects do not need to be rediscovered.',
  '- get_abap_source(canonicalKey, focusIdentifiers, focusCursor, focusWindowSize): read one exact ABAP source window. Start focusCursor=null. If focusPagination.hasMore=true, pass focusPagination.nextCursor to read another window. focusWindowSize only controls one transfer window.',
  '- search_document(query, limit) / get_document_content(canonicalKey): discover then read exact published documents.',
  'Prefer the shortest sufficient evidence path. For “what does this object call/emit/read/write?” questions, structural relation evidence is usually more direct than repeated broad search. Do not call discovery if one of these known capabilities already fits.',
].join('\n')

export const buildExecuteCapabilitiesTool = (): RuntimeToolSchema => ({
  type: 'function',
  name: EXECUTE_CAPABILITIES_TOOL_NAME,
  description: [
    'Execute one or more model-authored JetWork capability calls through the mechanical semantic action batching runtime.',
    'You choose every capability, argument and stop/re-plan decision. Runtime only validates the canonical name/schema, permission and budget.',
    FOUNDATIONAL_EVIDENCE_MENU,
    'If none of the core evidence capabilities fits, call discover_more_capabilities with a semantic description of the capability you need; use index only for a broad catalog.',
    'Batch independent actions whose arguments are already known. If one action needs an identifier produced by another, wait for that observation and continue in the next Controller round.',
    'Discovery candidates are not verified evidence. Exact/detail results may be citation-ready; preserve that provenance distinction.',
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
            capability: { type: 'string', minLength: 2, maxLength: 120 },
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

const jsonType = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  if (typeof value === 'number') return 'number'
  return typeof value
}

const validateSchemaValue = (
  value: unknown,
  rawSchema: unknown,
  path = '$',
): string | null => {
  if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) return null
  const schema = rawSchema as Record<string, unknown>
  const allowedTypes = Array.isArray(schema.type)
    ? schema.type.map(type => String(type))
    : schema.type ? [String(schema.type)] : []
  const actualType = jsonType(value)
  if (
    allowedTypes.length
    && !allowedTypes.includes(actualType)
    && !(actualType === 'integer' && allowedTypes.includes('number'))
  ) return `${path} must be ${allowedTypes.join('|')}; received ${actualType}`

  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => Object.is(candidate, value))) {
    return `${path} must be one of the canonical enum values`
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${path} is shorter than minLength`
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${path} exceeds maxLength`
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} is below minimum`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} exceeds maximum`
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path} has too few items`
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path} has too many items`
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateSchemaValue(value[index], schema.items, `${path}[${index}]`)
        if (error) return error
      }
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties as Record<string, unknown>
      : {}
    const required = Array.isArray(schema.required) ? schema.required.map(item => String(item)) : []
    for (const requiredName of required) {
      if (!(requiredName in object)) return `${path} is missing required property ${requiredName}`
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(object).find(key => !(key in properties))
      if (unknown) return `${path} contains unknown property ${unknown}`
    }
    for (const [key, child] of Object.entries(object)) {
      if (!(key in properties)) continue
      const error = validateSchemaValue(child, properties[key], `${path}.${key}`)
      if (error) return error
    }
  }

  return null
}

export const parseAndValidateCapabilityInvocation = (
  capability: string,
  argumentsJson: string,
):
  | { ok: true; tool: RuntimeToolSchema; args: Record<string, unknown> }
  | { ok: false; error: string } => {
  const name = String(capability || '').trim()
  if (!executionCapabilityNames.includes(name)) {
    return { ok: false, error: `Unknown or non-executable capability: ${name || '(empty)'}` }
  }
  const tool = getCanonicalCapabilityTool(name)
  if (!tool) return { ok: false, error: `Canonical capability contract not found: ${name}` }

  let parsed: unknown
  try {
    parsed = JSON.parse(String(argumentsJson || ''))
  } catch {
    return { ok: false, error: `argumentsJson for ${name} is not valid JSON` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: `argumentsJson for ${name} must decode to an object` }
  }
  const schemaError = validateSchemaValue(parsed, tool.parameters, '$')
  if (schemaError) return { ok: false, error: `${name}: ${schemaError}` }
  return { ok: true, tool, args: parsed as Record<string, unknown> }
}

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
  | { layer: 'semantic'; records: Array<{ name: string; category: string; summary: string; requiredArguments: string[]; score: number; title: string }> }
  | { layer: 'error'; records: []; message: string }

export interface ControllerCapabilitySession {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  discoveryMode: 'semantic_action_batch'
  fallbackReason?: string
  seenCandidateIds: string[]
  guidedToolNames: string[]
  activatedToolNames: string[]
  lastDisclosure: CapabilityDisclosure
  surface: ControllerCapabilitySurface
}

const basePhysicalTools = () => uniqueTools([
  REPORT_PROGRESS_TOOL,
  DISCOVER_MORE_CAPABILITIES_TOOL,
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
    discoveryMode: 'semantic_action_batch',
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
  const requestedLimit = Math.max(1, Math.min(Number(input.limit || 6), 8))

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

  const discovered = await discoverIndexedCapabilities({
    client: input.client,
    geminiApiKey: input.geminiApiKey,
    query,
    topK: requestedLimit,
    excludeIds: input.session.seenCandidateIds,
  })
  const seenNames = new Set<string>()
  let records = discovered.candidates.flatMap(candidate => {
    const name = String(candidate.toolName || '').trim()
    if (!name || seenNames.has(name) || !executionCapabilityNames.includes(name)) return []
    const entry = capabilityIndexEntry(name)
    if (!entry) return []
    seenNames.add(name)
    return [{
      name,
      category: entry.category,
      summary: entry.summary,
      requiredArguments: requiredArgumentNames(getCanonicalCapabilityTool(name)),
      score: candidate.score,
      title: candidate.title,
    }]
  }).slice(0, requestedLimit)

  // The persisted capability index also contains procedural skill records. A
  // model-authored tool need can therefore rank skills above executable tools.
  // If the vector Top-K yields no executable capability, fall back to the same
  // registry's lexical tool candidates rather than forcing another LLM round.
  if (!records.length) {
    const lexical = discoverCapabilityCandidates({
      query,
      topK: requestedLimit,
      categories: ['knowledge', 'context', 'artifact'],
    }).filter(candidate => candidate.kind === 'tool' && candidate.toolName)
    records = lexical.flatMap(candidate => {
      const name = String(candidate.toolName || '').trim()
      if (!name || seenNames.has(name) || !executionCapabilityNames.includes(name)) return []
      const entry = capabilityIndexEntry(name)
      if (!entry) return []
      seenNames.add(name)
      return [{
        name,
        category: entry.category,
        summary: entry.summary,
        requiredArguments: requiredArgumentNames(getCanonicalCapabilityTool(name)),
        score: candidate.score,
        title: candidate.title,
      }]
    }).slice(0, requestedLimit)
  }

  if (!records.length) {
    return {
      ...input.session,
      fallbackReason: discovered.fallbackReason || 'semantic_discovery_empty',
      lastDisclosure: { layer: 'error', records: [], message: 'No relevant executable capability candidate was found for that model-authored need. Rephrase the capability need or use index for the broad catalog.' },
    }
  }

  return {
    ...input.session,
    fallbackReason: discovered.fallbackReason,
    seenCandidateIds: [...new Set([...input.session.seenCandidateIds, ...discovered.candidates.map(candidate => candidate.id)])],
    lastDisclosure: { layer: 'semantic', records },
  }
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => ({
  version: session.version,
  disclosureVersion: CAPABILITY_DISCLOSURE_VERSION,
  discoveryMode: session.discoveryMode,
  visibleToolNames: session.surface.toolNames,
  disclosure: session.lastDisclosure,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'Capability catalog is lazy. The active model remains the sole semantic Controller: it may answer directly, execute a known capability, or request a small semantic candidate set with discover_more_capabilities. Runtime only validates name/schema/permission/budget and executes; it never makes the semantic choice. Discovery is candidate-only; exact/detail evidence provenance must be preserved.',
})

// Keep registry construction eager so drift between the 33 logical entries and canonical runtime is visible in tests/logs.
void JETWORK_CAPABILITY_INDEX
