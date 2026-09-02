import { describe, expect, it } from 'vitest'
import { runAgenticRuntimeV2Golden } from '../runAgenticRuntimeV2Golden'
import type { AgenticRuntimeV2GoldenScenario } from '../agenticRuntimeV2Scenarios'

const scenario: AgenticRuntimeV2GoldenScenario = {
  id: 'live-runner-test',
  category: 'exact_technical',
  turns: ['ZCRM2-586 hangi durumda oluşur?'],
  requiredCapabilities: ['knowledge'],
  forbiddenBehaviors: ['keyword_route'],
  assertions: ['verified_evidence_required'],
}

const passingMetrics = {
  groundedTechnicalClaimRatio: 0.99,
  unsupportedClaimRatio: 0,
  citationAccuracy: 1,
  retrievalRecall: 1,
  artifactIntegrity: null,
  controllerRounds: 2,
  toolCalls: 2,
  providerCalls: 2,
  ttftMs: 1000,
  totalLatencyMs: 3500,
  inputTokens: 1000,
  outputTokens: 400,
  costUsd: 0.01,
}

describe('agentic runtime v2 live golden runner', () => {
  it('combines runtime trace evaluation and the P6 quality scorecard', async () => {
    const report = await runAgenticRuntimeV2Golden({
      scenarios: [scenario],
      execute: async () => ({
        telemetry: {
          completed: true,
          toolRuns: [{
            toolName: 'search_knowledge_catalog',
            status: 'completed',
            selectedByController: true,
            summary: { citationReady: true },
          }],
          evidenceSummary: { knowledgeSources: 1 },
          judgeAssertions: ['verified_evidence_required'],
          observedBehaviors: [],
        },
        metrics: passingMetrics,
      }),
    })

    expect(report.scenarioSummary.releaseGatePassed).toBe(true)
    expect(report.scorecard.releaseQualityGatePassed).toBe(true)
    expect(report.releaseGatePassed).toBe(true)
  })

  it('fails the combined release gate when a forbidden runtime behavior is observed', async () => {
    const report = await runAgenticRuntimeV2Golden({
      scenarios: [scenario],
      execute: async () => ({
        telemetry: {
          completed: true,
          toolRuns: [{
            toolName: 'search_knowledge_catalog',
            status: 'completed',
            selectedByController: true,
            summary: { citationReady: true },
          }],
          evidenceSummary: { knowledgeSources: 1 },
          judgeAssertions: ['verified_evidence_required'],
          observedBehaviors: ['keyword_route'],
        },
        metrics: passingMetrics,
      }),
    })

    expect(report.scenarioResults[0].evaluation.forbiddenBehaviorsObserved).toEqual(['keyword_route'])
    expect(report.releaseGatePassed).toBe(false)
  })
})
