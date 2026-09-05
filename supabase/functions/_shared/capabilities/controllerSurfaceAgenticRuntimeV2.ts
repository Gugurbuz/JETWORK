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
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@c6f043da2ce21232e2e992480dae956ef0e9f2c6/supabase/functions/_shared/capabilities/controllerSurfaceAgenticRuntime.ts?surface-v2-base=1'
import type { CapabilityCandidate } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@498100e3333d5c13522fbf4c5d02cb1b9e643e8f/supabase/functions/_shared/capabilities/discovery.ts?surface-v2-base=1'
import {
  ARTIFACT_BUNDLE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
} from '../assistantToolsAgenticRuntimeV3.ts'

export {
  CONTROLLER_CAPABILITY_SURFACE_VERSION,
  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
}
export type { ControllerCapabilitySession, ControllerCapabilitySurface }

export const CONTROLLER_ORCHESTRATION_LAYER_VERSION = `${BASE_ORCHESTRATION_LAYER_VERSION}+core-capabilities-v2`

const ensureTool = (tools: any[], schema: any) => (
  tools.some(tool => tool?.name === schema.name) ? tools : [...tools, schema]
)

const ensureCoreCapabilities = (surface: ControllerCapabilitySurface): ControllerCapabilitySurface => {
  let tools = [...surface.tools]
  tools = ensureTool(tools, HIGH_LEVEL_KNOWLEDGE_TOOL as any)
  tools = ensureTool(tools, ARTIFACT_BUNDLE_TOOL as any)
  return {
    ...surface,
    tools,
    toolNames: tools.map(tool => tool.name),
  }
}

const ensureSession = (session: ControllerCapabilitySession): ControllerCapabilitySession => ({
  ...session,
  surface: ensureCoreCapabilities(session.surface),
})

export const buildControllerCapabilitySurface = (
  candidates: readonly CapabilityCandidate[],
): ControllerCapabilitySurface => ensureCoreCapabilities(baseBuildControllerCapabilitySurface(candidates))

export async function startControllerCapabilitySession(input: {
  client: any
  geminiApiKey?: string
  query: string
  topK?: number
}): Promise<ControllerCapabilitySession> {
  return ensureSession(await baseStartControllerCapabilitySession(input))
}

export async function discoverMoreForController(input: {
  client: any
  geminiApiKey?: string
  query: string
  limit?: number | null
  session: ControllerCapabilitySession
}): Promise<ControllerCapabilitySession> {
  return ensureSession(await baseDiscoverMoreForController(input as any))
}

export const capabilitySessionObservation = (session: ControllerCapabilitySession) => {
  const ensured = ensureSession(session)
  const base = baseCapabilitySessionObservation(ensured as any) as Record<string, unknown>
  return {
    ...base,
    orchestrationLayerVersion: CONTROLLER_ORCHESTRATION_LAYER_VERSION,
    visibleToolNames: ensured.surface.toolNames,
    instruction: [
      'Core controller capabilities are always available at a high level: research_knowledge for enterprise evidence and create_artifact_bundle for final DOCX/XLSX deliverables.',
      'Do not manage search/list/get/relation retrieval internals. Put all currently known target entities and requested technical aspects into one research_knowledge request.',
      'Knowledge Runtime v3 resolves every explicit exact target before relation expansion. A result with mechanicalCoverageComplete=true means the explicit requested targets were exact-verified and unresolvedCount is zero.',
      'When mechanicalCoverageComplete=true, reason from the shared evidence bundle and move to the next user goal such as comparison, impact analysis or artifact generation instead of repeating the same knowledge request.',
      'For Word + Excel from the same analysis, call create_artifact_bundle once with both document and spreadsheet populated after the analysis is ready.',
    ].join(' '),
  }
}
