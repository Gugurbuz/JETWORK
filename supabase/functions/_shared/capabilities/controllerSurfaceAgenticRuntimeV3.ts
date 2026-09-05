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

const artifactBundleSchema = {
  ...ARTIFACT_BUNDLE_TOOL,
  description: 'High-level final artifact engine for NEW DOCX and/or XLSX deliverables. If the user requests Word, Excel, or both from an analysis, use this capability directly after evidence/reasoning is ready. Populate document and spreadsheet together when both were requested. Do not discover document contracts or call low-level create_document_file/create_spreadsheet_file first; this runtime handles those execution details and verification internally.',
}

const sanitizeTools = (tools: any[]) => tools.filter(tool => !HIDDEN_NEW_FILE_MICRO_TOOLS.has(String(tool?.name || '')))

const ensureTool = (tools: any[], schema: any) => (
  tools.some(tool => tool?.name === schema.name) ? tools : [...tools, schema]
)

const normalizeSurface = (surface: ControllerCapabilitySurface): ControllerCapabilitySurface => {
  let tools = sanitizeTools([...surface.tools])
  tools = ensureTool(tools, HIGH_LEVEL_KNOWLEDGE_TOOL as any)
  tools = tools.filter(tool => tool?.name !== artifactBundleSchema.name)
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
      'New DOCX/XLSX creation is intentionally exposed as one high-level create_artifact_bundle capability. Low-level new-file creation and document-contract micro tools are hidden from the controller surface.',
      'When both Word and Excel are requested from the same analysis, create_artifact_bundle must receive both outputs in the same call.',
    ].filter(Boolean).join(' '),
  }
}
