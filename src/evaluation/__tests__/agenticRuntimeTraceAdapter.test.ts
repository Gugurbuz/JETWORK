import { describe, expect, it } from 'vitest'
import {
  adaptAgenticRuntimeTelemetry,
  telemetryHasControllerArtifactCompletion,
} from '../agenticRuntimeTraceAdapter'

const artifactVerification = {
  version: 'artifact-verifier-v2',
  reloadVerified: true,
  integrityVerified: true,
  artifactCount: 1,
}

describe('Agentic Runtime V2 telemetry adapter', () => {
  it('derives mechanical capability usage from controller telemetry without inventing semantic assertions', () => {
    const trace = adaptAgenticRuntimeTelemetry({
      completed: true,
      evidenceSummary: {
        controllerMode: true,
        capabilityDiscovery: { candidates: [], visibleToolNames: [], providerWebVisible: false },
        knowledgeSources: 2,
        webSources: 1,
      },
      toolRuns: [
        { toolName: 'discover_more_capabilities', status: 'completed', selectedByController: true },
        { toolName: 'record_project_memory', status: 'completed', selectedByController: true },
      ],
      judgeAssertions: ['user_source_required_for_decision'],
    })

    expect(trace.selectedCapabilities).toEqual(expect.arrayContaining(['capability_discovery', 'knowledge', 'web', 'project_memory']))
    expect(trace.assertionsSatisfied).toEqual(['user_source_required_for_decision'])
    expect(trace.assertionsSatisfied).not.toContain('correction_supersedes_old_version')
  })

  it('maps the P4 evidence-review observation tool to the critic capability', () => {
    const trace = adaptAgenticRuntimeTelemetry({
      completed: true,
      toolRuns: [{
        toolName: 'review_evidence_coverage',
        status: 'completed',
        selectedByController: true,
        summary: { evidenceReview: true, controllerDecisionRequired: true },
      }],
    })

    expect(trace.selectedCapabilities).toContain('critic')
    expect(trace.observations).toContain('review_evidence_coverage:completed')
  })

  it('requires reload + integrity telemetry for artifact completion', () => {
    const verifiedInput = {
      completed: true,
      toolRuns: [{
        toolName: 'create_document_file',
        status: 'completed' as const,
        selectedByController: true,
        summary: { artifactVerification },
      }],
    }
    const trace = adaptAgenticRuntimeTelemetry(verifiedInput)
    expect(trace.selectedCapabilities).toEqual(expect.arrayContaining(['create_document_file', 'artifact_verifier']))
    expect(trace.artifact).toEqual({
      executorSucceeded: true,
      reloadVerified: true,
      integrityVerified: true,
      persisted: true,
    })
    expect(telemetryHasControllerArtifactCompletion(verifiedInput)).toBe(true)

    expect(telemetryHasControllerArtifactCompletion({
      completed: true,
      toolRuns: [{
        toolName: 'create_document_file',
        status: 'completed',
        selectedByController: true,
        summary: { artifactVerification: { ...artifactVerification, reloadVerified: false } },
      }],
    })).toBe(false)
  })

  it('does not count failed or explicitly non-controller tool runs as selected capabilities', () => {
    const trace = adaptAgenticRuntimeTelemetry({
      completed: false,
      toolRuns: [
        { toolName: 'record_project_memory', status: 'failed', selectedByController: true },
        { toolName: 'create_document_file', status: 'completed', selectedByController: false, summary: { artifactVerification } },
      ],
    })
    expect(trace.selectedCapabilities).not.toContain('project_memory')
    expect(trace.selectedCapabilities).not.toContain('create_document_file')
    expect(trace.artifact).toBeUndefined()
  })
})
