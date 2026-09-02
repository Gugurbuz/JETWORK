import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_SKILL_TOOLS } from '../skillTools.ts'
import { ASSISTANT_CONTEXT_TOOLS } from '../contextTools.ts'
import {
  discoverIndexedCapabilities,
  type IndexedCapabilityDiscoveryResult,
} from './indexedDiscovery.ts'
import type { CapabilityCandidate } from './discovery.ts'
import type { RuntimeToolSchema } from './registry.ts'

export const CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v2'
export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'
export const REVIEW_EVIDENCE_COVERAGE_TOOL_NAME = 'review_evidence_coverage'

const TOP_K_DEFAULT = 10
const TOP_K_MAX = 12
const MAX_SESSION_CANDIDATES = 36

const runtimeTools = [
  ...(ASSISTANT_SKILL_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_KNOWLEDGE_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_CONTEXT_TOOLS as unknown as RuntimeToolSchema[]),
]
const runtimeToolByName = new Map(runtimeTools.map(tool => [tool.name, tool]))
const ALWAYS_VISIBLE_META_TOOLS = ['load_skills', 'list_capabilities'] as const

export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  description: 'Request another semantic candidate batch when the currently visible JetWork capabilities are insufficient for the goal. This only retrieves more candidates; it never executes them. Use a focused semantic query describing the missing capability. The controller LLM remains responsible for choosing what to call next.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 2, maxLength: 2_000 },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: TOP_K_MAX },
    },
    required: ['query', 'limit'],
    additionalProperties: false,
  },
}

export const REVIEW_EVIDENCE_COVERAGE_TOOL: RuntimeToolSchema = {
  type: 'function',
  name: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
  description: 'Review the current mechanically verified evidence ledger after you, the controller LLM, propose which evidence IDs support which user-question aspects. This does not search, choose another tool, or finalize the answer. Runtime validates the evidence IDs and returns coverage/gap/conflict observations from the critic; you decide what to do next.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      aspects: {
        type: 'array',
        minItems: 1,
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
    },
    required: ['aspects'],
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
    kind: CapabilityCandidate['kind']
    category: CapabilityCandidate['category']
    title: string
    toolName?: string
    skillKey?: string
    score: number
  }>
}

export interface ControllerCapabilitySession {
  version: typeof CONTROLLER_CAPABILITY_SURFACE_VERSION
  discoveryMode: IndexedCapabilityDiscoveryResult['mode']
  fallbackReason?: string
  seenCandidateIds: string[]
  surface: ControllerCapabilitySurface
}

const boundedTopK = (value: number | undefined | null) => Math.max(1, Math.min(Math.trunc(Number(value) || TOP_K_DEFAULT), TOP_K_MAX))

const uniqueTools = (tools: RuntimeToolSchema[]) => {
  const seen = new Set<string>()
  return tools.filter(tool => {
    if (!tool?.name || seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

export const buildControllerCapabilitySurface = (
  candidates: readonly CapabilityCandidate[],
): ControllerCapabilitySurface => {
  const selectedTools: RuntimeToolSchema[] = []
  for (const name of ALWAYS_VISIBLE_META_TOOLS) {
    const schema = runtimeToolByName.get(name)
    if (schema) selectedTools.push(schema)
  }
  selectedTools.push(DISCOVER_MORE_CAPABILITIES_TOOL, REVIEW_EVIDENCE_COVERAGE_TOOL)

  for (const candidate of candidates) {
    if (!candidate.toolName || candidate.toolName === 'provider_web') continue
    const schema = runtimeToolByName.get(candidate.toolName)
    if (schema) selectedTools.push(schema)
  }

  const tools = uniqueTools(selectedTools)
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    tools,
    providerWebVisible: candidates.some(candidate => candidate.toolName === 'provider_web' || candidate.id === 'provider:web_search'),
    candidateIds: candidates.map(candidate => candidate.id),
    toolNames: tools.map(tool => tool.name),
    skillKeys: [...new Set(candidates.map(candidate => candidate.skillKey).filter((value): value is string => Boolean(value)))],
    candidates: candidates.map(candidate => ({
      id: candidate.id,
      kind: candidate.kind,
      category: candidate.category,
      title: candidate.title,
      toolName: candidate.toolName,
      skillKey: candidate.skillKey,
      score: candidate.score,
    })),
  }
}

const mergeCandidates = (
  existing: readonly CapabilityCandidate[],
  next: readonly CapabilityCandidate[],
) => {
  const merged = new Map(existing.map(candidate => [candidate.id, candidate]))
  for (const candidate of next) {
    if (!merged.has(candidate.id) && merged.size < MAX_SESSION_CANDIDATES) merged.set(candidate.id, candidate)
  }
  return [...merged.values()]
}

export async function startControllerCapabilitySession(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  const discovery = await discoverIndexedCapabilities({
    client: input.client,
    geminiApiKey: input.geminiApiKey,
    query: input.query,
    topK: boundedTopK(input.topK),
  })
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    discoveryMode: discovery.mode,
    fallbackReason: discovery.fallbackReason,
    seenCandidateIds: discovery.candidates.map(candidate => candidate.id),
    surface: buildControllerCapabilitySurface(discovery.candidates),
  }
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  const discovery = await discoverIndexedCapabilities({
    client: input.client,
    geminiApiKey: input.geminiApiKey,
    query: input.query,
    topK: boundedTopK(input.limit),
    excludeIds: input.session.seenCandidateIds,
  })
  const existing = input.session.surface.candidates.map(candidate => ({
    ...candidate,
    description: '',
    semanticScore: null,
    lexicalScore: 0,
    registryVersion: '',
    discoveryVersion: '',
  })) as CapabilityCandidate[]
  const merged = mergeCandidates(existing, discovery.candidates)
  return {
    version: CONTROLLER_CAPABILITY_SURFACE_VERSION,
    discoveryMode: discovery.mode,
    fallbackReason: discovery.fallbackReason,
    seenCandidateIds: [...new Set([...input.session.seenCandidateIds, ...discovery.candidates.map(candidate => candidate.id)])].slice(0, MAX_SESSION_CANDIDATES),
    surface: buildControllerCapabilitySurface(merged),
  }
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => ({
  version: session.version,
  discoveryMode: session.discoveryMode,
  fallbackReason: session.fallbackReason || null,
  candidates: session.surface.candidates,
  visibleToolNames: session.surface.toolNames,
  providerWebVisible: session.surface.providerWebVisible,
  instruction: 'These are candidate capabilities only. Choose the next capability semantically. If insufficient, call discover_more_capabilities. Use review_evidence_coverage only to review verified evidence coverage; it never chooses the next capability or finalizes the answer.',
})
