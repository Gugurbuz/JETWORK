import { describe, expect, it } from 'vitest';
import { routeReasoningRequest } from '../../../supabase/functions/_shared/reasoningEngine';
import {
  evaluateReasoningObservedRun,
  evaluateReasoningRoute,
  summarizeReasoningGoldenSuite,
  type ReasoningGoldenObservedRun,
} from '../evaluateReasoningGolden';
import {
  REASONING_GOLDEN_COVERAGE,
  REASONING_GOLDEN_SCENARIOS,
  type ReasoningGoldenScenario,
} from '../reasoningGoldenScenarios';

const perfectObservedRun = (scenario: ReasoningGoldenScenario): ReasoningGoldenObservedRun => ({
  route: { ...scenario.expectedRoute },
  stages: [...scenario.expectedRuntime.requiredStages],
  sources: [
    ...Array.from({ length: scenario.expectedRuntime.minimumKnowledgeSources || 0 }, (_, index) => ({
      sourceType: 'knowledge' as const,
      sourceName: `Knowledge ${index + 1}`,
    })),
    ...Array.from({ length: scenario.expectedRuntime.minimumWebSources || 0 }, (_, index) => ({
      sourceType: 'web' as const,
      sourceName: `Web ${index + 1}`,
      url: `https://example.com/${index + 1}`,
    })),
  ],
  toolCallCount: scenario.expectedRuntime.minimumToolCalls || 0,
  verification: scenario.expectedRoute.verificationRequired
    ? { verdict: 'sufficient', confidence: 0.9 }
    : undefined,
  answerText: scenario.expectedRuntime.requireUncertaintyLanguageWhenNoEvidence
    ? 'Bilgi bankasında kayıt bulunamadı; yeterli kanıt olmadan kesin kök neden söyleyemem.'
    : (scenario.expectedRuntime.requiredAnswerConcepts || []).join(' '),
  completed: true,
  errorMessage: null,
});

describe('Reasoning Quality Golden Set coverage', () => {
  it('keeps enough scenarios, critical gates, live canaries and category diversity', () => {
    expect(REASONING_GOLDEN_SCENARIOS.length).toBeGreaterThanOrEqual(REASONING_GOLDEN_COVERAGE.minimumScenarioCount);
    expect(REASONING_GOLDEN_SCENARIOS.filter(item => item.critical).length)
      .toBeGreaterThanOrEqual(REASONING_GOLDEN_COVERAGE.minimumCriticalScenarios);
    expect(REASONING_GOLDEN_SCENARIOS.filter(item => item.liveCanary).length)
      .toBeGreaterThanOrEqual(REASONING_GOLDEN_COVERAGE.minimumLiveCanaries);

    const categories = new Set(REASONING_GOLDEN_SCENARIOS.map(item => item.category));
    for (const category of REASONING_GOLDEN_COVERAGE.requiredCategories) {
      expect(categories.has(category), `missing category ${category}`).toBe(true);
    }
  });

  it('uses unique stable scenario ids', () => {
    const ids = REASONING_GOLDEN_SCENARIOS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Reasoning Engine v2 golden route contract', () => {
  for (const scenario of REASONING_GOLDEN_SCENARIOS) {
    it(`${scenario.id} — ${scenario.title}`, () => {
      const route = routeReasoningRequest(scenario.request, scenario.attachmentCount || 0);
      const evaluation = evaluateReasoningRoute(scenario, route);
      expect(evaluation.hardFailures, JSON.stringify(evaluation.hardFailures)).toEqual([]);
      expect(evaluation.score).toBe(100);
    });
  }
});

describe('Reasoning Quality runtime evaluator', () => {
  it('awards a perfect run when observable execution follows the contract', () => {
    const scenario = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-03-sap-diagnosis-message')!;
    const evaluation = evaluateReasoningObservedRun(scenario, perfectObservedRun(scenario));
    expect(evaluation.score).toBe(100);
    expect(evaluation.hardFailures).toEqual([]);
  });

  it('hard-fails a technical diagnosis that skips corporate evidence', () => {
    const scenario = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-03-sap-diagnosis-message')!;
    const observed = perfectObservedRun(scenario);
    observed.sources = [];
    observed.stages = observed.stages.filter(stage => stage !== 'searching_knowledge');
    observed.toolCallCount = 0;
    const evaluation = evaluateReasoningObservedRun(scenario, observed);
    expect(evaluation.hardFailures.some(failure => failure.startsWith('knowledge_evidence_missing'))).toBe(true);
    expect(evaluation.hardFailures.some(failure => failure.startsWith('missing_stages'))).toBe(true);
  });

  it('hard-fails current research without a web source', () => {
    const scenario = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-12-current-regulation')!;
    const observed = perfectObservedRun(scenario);
    observed.sources = [];
    const evaluation = evaluateReasoningObservedRun(scenario, observed);
    expect(evaluation.hardFailures.some(failure => failure.startsWith('required_web_evidence_missing'))).toBe(true);
  });

  it('hard-fails confident unsupported claims when no internal evidence exists', () => {
    const scenario = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-21-unknown-internal-error')!;
    const observed = perfectObservedRun(scenario);
    observed.sources = [];
    observed.answerText = 'Kesin kök neden ilgili methoddaki kontrol koşuludur.';
    const evaluation = evaluateReasoningObservedRun(scenario, observed);
    expect(evaluation.hardFailures).toContain('uncertainty_language_missing_without_evidence');
  });

  it('summarizes critical failures independently from the overall score', () => {
    const critical = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-03-sap-diagnosis-message')!;
    const nonCritical = REASONING_GOLDEN_SCENARIOS.find(item => item.id === 'rq-02-simple-role-question')!;
    const bad = perfectObservedRun(critical);
    bad.completed = false;
    bad.errorMessage = 'runtime failed';
    const entries = [
      { scenario: critical, evaluation: evaluateReasoningObservedRun(critical, bad) },
      { scenario: nonCritical, evaluation: evaluateReasoningObservedRun(nonCritical, perfectObservedRun(nonCritical)) },
    ];
    const summary = summarizeReasoningGoldenSuite(entries);
    expect(summary.criticalHardFailureCount).toBeGreaterThan(0);
    expect(summary.failedScenarioIds).toContain(critical.id);
  });
});
