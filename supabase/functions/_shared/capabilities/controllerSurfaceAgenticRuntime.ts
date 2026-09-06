import {
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
  buildControllerCapabilitySurface as baseBuildControllerCapabilitySurface,
  capabilitySessionObservation as baseCapabilitySessionObservation,
  discoverMoreForController as baseDiscoverMoreForController,
  startControllerCapabilitySession as baseStartControllerCapabilitySession,
  type ControllerCapabilitySession,
  type ControllerCapabilitySurface,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@498100e3333d5c13522fbf4c5d02cb1b9e643e8f/supabase/functions/_shared/capabilities/controllerSurface.ts?agentic-surface-base=1'
import type { CapabilityCandidate } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@498100e3333d5c13522fbf4c5d02cb1b9e643e8f/supabase/functions/_shared/capabilities/discovery.ts?agentic-surface-base=1'
import {
  ARTIFACT_BUNDLE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
} from '../assistantToolsAgenticRuntime.ts'

export {
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
}
export type { ControllerCapabilitySession, ControllerCapabilitySurface }

export const CONTROLLER_ORCHESTRATION_LAYER_VERSION = 'knowledge-orchestrator-v1'

const LEGACY_KNOWLEDGE_TOOLS = new Set([
  'search_knowledge_catalog',
  'list_knowledge_catalog',
  'list_class_inventory',
  'get_abap_source',
  'get_message_detail',
  'search_document',
  'get_document_content',
  'get_knowledge_object',
  'get_knowledge_objects',
  'get_related_objects',
])

const ARTIFACT_EXECUTORS = new Set([
  'create_document_file',
  'create_spreadsheet_file',
  'edit_office_file',
  'edit_spreadsheet_file',
  'transform_spreadsheet_file',
])

const candidateToolNames = (candidate: any) => [
  String(candidate?.toolName || ''),
  ...(Array.isArray(candidate?.executorTools) ? candidate.executorTools.map(String) : []),
]

const withTool = (tools: any[], schema: any) => (
  tools.some(tool => tool?.name === schema.name) ? tools : [...tools, schema]
)

const collapseSurface = (surface: ControllerCapabilitySurface): ControllerCapabilitySurface => {
  const existingToolNames = new Set(surface.tools.map(tool => tool.name))
  const candidateNames = surface.candidates.flatMap(candidateToolNames)
  const knowledgeRelevant = [...existingToolNames, ...candidateNames].some(name => LEGACY_KNOWLEDGE_TOOLS.has(name))
  const artifactRelevant = [...existingToolNames, ...candidateNames].some(name => ARTIFACT_EXECUTORS.has(name))

  let tools = surface.tools.filter(tool => !LEGACY_KNOWLEDGE_TOOLS.has(tool.name))
  if (knowledgeRelevant) tools = withTool(tools, HIGH_LEVEL_KNOWLEDGE_TOOL as any)
  if (artifactRelevant) tools = withTool(tools, ARTIFACT_BUNDLE_TOOL as any)

  return {
    ...surface,
    tools,
    toolNames: tools.map(tool => tool.name),
  }
}

const collapseSession = (session: ControllerCapabilitySession): ControllerCapabilitySession => ({
  ...session,
  surface: collapseSurface(session.surface),
})

export const buildControllerCapabilitySurface = (
  candidates: readonly CapabilityCandidate[],
): ControllerCapabilitySurface => collapseSurface(baseBuildControllerCapabilitySurface(candidates))

export async function startControllerCapabilitySession(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return collapseSession(await baseStartControllerCapabilitySession(input))
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  return collapseSession(await baseDiscoverMoreForController(input as any))
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => {
  const collapsed = collapseSession(session)
  const base = baseCapabilitySessionObservation(collapsed as any) as Record<string, unknown>
  return {
    ...base,
    orchestrationLayerVersion: CONTROLLER_ORCHESTRATION_LAYER_VERSION,
    visibleToolNames: collapsed.surface.toolNames,
    instruction: [
      'These are high-level candidate capabilities. The controller LLM chooses the capability semantically; runtime executes its internal mechanics.',
      'For enterprise/project facts use research_knowledge. Do not manage search/list/get/relation micro-protocols yourself; the Knowledge Runtime resolves canonical identities, verifies published records and expands bounded relations.',
      'Treat a research_knowledge result with sharedEvidenceBundle=true as reusable current-turn analysis evidence. Do not rerun knowledge merely because the same analysis will be rendered into another output format.',
      'When the user requests Word and Excel (or multiple final files) from the same analysis, prefer create_artifact_bundle after the analysis is ready. It can generate both deliverables from the same state in one execution.',
      'Artifact execution is not factual research. If enterprise facts are still missing, obtain evidence first; if the evidence is sufficient, reason from it and create the requested outputs without reopening retrieval.',
    ].join(' '),
  }
}
