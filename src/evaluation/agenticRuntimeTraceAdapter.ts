import type { AgenticRuntimeTrace } from './evaluateAgenticRuntimeV2'

export interface RuntimeToolTraceRow {
  toolName: string
  status: 'completed' | 'failed'
  selectedByController?: boolean
  summary?: Record<string, unknown>
}

export interface RuntimeEvidenceSummary {
  controllerMode?: boolean
  capabilityDiscovery?: {
    candidates?: Array<{ category?: string; toolName?: string; id?: string }>
    visibleToolNames?: string[]
    providerWebVisible?: boolean
  } | null
  knowledgeSources?: number
  webSources?: number
  groundingCoverage?: {
    blocked?: boolean
    unsupportedIdentifiers?: string[]
  }
}

export interface AgenticRuntimeTelemetryInput {
  completed: boolean
  toolRuns: RuntimeToolTraceRow[]
  evidenceSummary?: RuntimeEvidenceSummary | null
  judgeAssertions?: string[]
  observedBehaviors?: string[]
}

const completedControllerTools = (rows: readonly RuntimeToolTraceRow[]) => rows.filter(row => (
  row.status === 'completed' && row.selectedByController !== false
))

const includesTool = (rows: readonly RuntimeToolTraceRow[], name: string) => rows.some(row => row.toolName === name)

/**
 * Maps mechanical runtime telemetry into the P6 release trace contract. This
 * adapter does not judge semantic answer quality. Semantic assertions remain
 * explicit judge outputs and are merely carried into the deterministic scorer.
 */
export const adaptAgenticRuntimeTelemetry = (input: AgenticRuntimeTelemetryInput): AgenticRuntimeTrace => {
  const completedTools = completedControllerTools(input.toolRuns)
  const selectedCapabilities = new Set<string>()
  const observations: string[] = []

  if (input.evidenceSummary?.capabilityDiscovery) selectedCapabilities.add('capability_discovery')
  if ((input.evidenceSummary?.knowledgeSources || 0) > 0) selectedCapabilities.add('knowledge')
  if ((input.evidenceSummary?.webSources || 0) > 0) selectedCapabilities.add('web')

  for (const row of completedTools) {
    if (row.toolName === 'load_document_contract') selectedCapabilities.add('load_document_contract')
    if (row.toolName === 'create_document_file') selectedCapabilities.add('create_document_file')
    if (row.toolName === 'record_project_memory') selectedCapabilities.add('project_memory')
    if (row.toolName === 'discover_more_capabilities') selectedCapabilities.add('capability_discovery')
    if (row.toolName.includes('critic')) selectedCapabilities.add('critic')
    if (row.summary?.artifactVerification) selectedCapabilities.add('artifact_verifier')
    if (row.summary?.verifiedKnowledgeEvidence === true || row.summary?.citationReady === true) selectedCapabilities.add('knowledge')
    observations.push(`${row.toolName}:${row.status}`)
  }

  if (input.judgeAssertions?.includes('latest_decision_preserved') || input.judgeAssertions?.includes('continuation_without_reasking')) {
    selectedCapabilities.add('resolved_context')
  }

  const artifactTool = [...completedTools].reverse().find(row => row.summary?.artifactVerification)
  const artifactVerification = artifactTool?.summary?.artifactVerification as Record<string, unknown> | undefined
  const artifact = artifactTool ? {
    executorSucceeded: true,
    reloadVerified: artifactVerification?.reloadVerified === true,
    integrityVerified: artifactVerification?.integrityVerified === true,
    persisted: artifactVerification?.reloadVerified === true && artifactVerification?.integrityVerified === true,
  } : undefined

  return {
    selectedCapabilities: [...selectedCapabilities],
    observations,
    assertionsSatisfied: [...new Set(input.judgeAssertions || [])],
    behaviorsObserved: [...new Set(input.observedBehaviors || [])],
    completed: input.completed,
    artifact,
  }
}

export const telemetryHasControllerArtifactCompletion = (input: AgenticRuntimeTelemetryInput) => {
  const completedTools = completedControllerTools(input.toolRuns)
  return includesTool(completedTools, 'create_document_file')
    && completedTools.some(row => {
      const verification = row.summary?.artifactVerification as Record<string, unknown> | undefined
      return verification?.reloadVerified === true && verification?.integrityVerified === true
    })
}
