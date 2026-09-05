import {
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  CONTROLLER_ORCHESTRATION_LAYER_VERSION as BASE_ORCHESTRATION_LAYER_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
  buildControllerCapabilitySurface as baseBuildControllerCapabilitySurface,
  capabilitySessionObservation as baseCapabilitySessionObservation,
  discoverMoreForController as baseDiscoverMoreForController,
  startControllerCapabilitySession as baseStartControllerCapabilitySession,
  type ControllerCapabilitySession,
  type ControllerCapabilitySurface,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3c52565c0d4db326dbc81fc7bd698c67f539fe16/supabase/functions/_shared/capabilities/controllerSurfaceAgenticRuntimeV2.ts?surface-v3-base=1'
import type { CapabilityCandidate } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@498100e3333d5c13522fbf4c5d02cb1b9e643e8f/supabase/functions/_shared/capabilities/discovery.ts?surface-v3-base=1'
import {
  ARTIFACT_BUNDLE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
} from '../assistantToolsAgenticRuntimeV4.ts'

export {
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
}
export type { ControllerCapabilitySession, ControllerCapabilitySurface }

export const CONTROLLER_ORCHESTRATION_LAYER_VERSION = `${BASE_ORCHESTRATION_LAYER_VERSION}+artifact-surface-v3`

const HIDDEN_NEW_FILE_MICRO_TOOLS = new Set([
  'create_document_file',
  'create_spreadsheet_file',
  'load_document_contract',
])

const knowledgeToolSchema = {
  ...HIGH_LEVEL_KNOWLEDGE_TOOL,
  description: 'High-level JetWork enterprise knowledge capability. Preserve every explicit technical identifier from the user current request verbatim in request and/or entities, and submit all explicitly requested comparison targets together in ONE research_knowledge call. Do not begin an exact-identifier comparison with a generic discovery query that drops those identifiers. The runtime handles canonical resolution, semantic candidate retrieval, exact verification, provenance reconciliation and bounded relation expansion internally. Use the returned verified evidence bundle for reasoning; do not decompose normal knowledge work into search/list/get micro-tools.',
}

const artifactBundleSchema = {
  ...ARTIFACT_BUNDLE_TOOL,
  description: 'High-level final artifact engine for NEW DOCX and/or XLSX deliverables. If the user requests Word, Excel, or both from an analysis, use this capability directly after evidence/reasoning is ready. Populate document and spreadsheet together when both were requested. Every enterprise identifier and factual technical claim placed in artifact arguments must come from the verified shared evidence already returned by research_knowledge; never invent a plausible identifier. If this tool returns ARTIFACT_GROUNDING_VALIDATION_FAILED, correct the artifact arguments using the existing verified evidence and retry create_artifact_bundle. Do not rerun completed research unless the evidence itself is incomplete. Do not discover document contracts or call low-level create_document_file/create_spreadsheet_file first; this runtime handles those execution details and verification internally.',
}

const sanitizeTools = (tools: any[]) => tools.filter(tool => !HIDDEN_NEW_FILE_MICRO_TOOLS.has(String(tool?.name || '')))

const normalizeSurface = (surface: ControllerCapabilitySurface): ControllerCapabilitySurface => {
  let tools = sanitizeTools([...surface.tools])
  tools = tools.filter(tool => tool?.name !== knowledgeToolSchema.name && tool?.name !== artifactBundleSchema.name)
  tools.push(knowledgeToolSchema as any)
  tools.push(artifactBundleSchema as any)
  return {
    ...surface,
    tools,
    toolNames: tools.map(tool => tool.name),
  }
}

const normalizeSession = (session: ControllerCapabilitySession): ControllerCapabilitySession => ({
  ...session,
  surface: normalizeSurface(session.surface),
})

export const buildControllerCapabilitySurface = (
  candidates: readonly CapabilityCandidate[],
): ControllerCapabilitySurface => normalizeSurface(baseBuildControllerCapabilitySurface(candidates))

export async function startControllerCapabilitySession(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return normalizeSession(await baseStartControllerCapabilitySession(input))
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  return normalizeSession(await baseDiscoverMoreForController(input as any))
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => {
  const ensured = normalizeSession(session)
  const base = baseCapabilitySessionObservation(ensured as any) as Record<string, unknown>
  return {
    ...base,
    orchestrationLayerVersion: CONTROLLER_ORCHESTRATION_LAYER_VERSION,
    visibleToolNames: ensured.surface.toolNames,
    instruction: [
      String(base.instruction || ''),
      'For exact technical identifiers, preserve all explicitly requested targets in the same research_knowledge call; do not replace them with a generic discovery request first.',
      'New DOCX/XLSX creation is intentionally exposed as one high-level create_artifact_bundle capability. Low-level new-file creation and document-contract micro tools are hidden from the controller surface.',
      'When both Word and Excel are requested from the same analysis, create_artifact_bundle must receive both outputs in the same call.',
      'Artifact factual identifiers must be copied from verified evidence. On ARTIFACT_GROUNDING_VALIDATION_FAILED, correct the arguments from that evidence and retry the same artifact capability instead of reopening completed research.',
    ].filter(Boolean).join(' '),
  }
}
