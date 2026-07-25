import { buildAiTurnDecision } from '../../services/ai/aiTurnDecision';
import { buildBaCognitiveFrame } from '../../services/ai/baCognitiveFrame';
import {
  applyBehaviorDecisionToClassification,
  buildBehaviorDecision,
} from '../../services/ai/behaviorDecision';
import { computeDiscoverySignals } from '../../services/ai/discoveryPolicy';
import { buildClassification } from '../../services/ai/intentClassifier';
import {
  analyzeSourceIntelligence,
  buildSourceCorpus,
} from '../../services/sourceIntelligence';
import { goldenScenarios } from './scenarios';
import type {
  GoldenRuntimeResult,
  GoldenScenario,
  GoldenScenarioCategory,
  Sprint0Baseline,
} from './types';

function recentConversation(scenario: GoldenScenario): string {
  return (scenario.messages || [])
    .slice(-6)
    .map(message => message.text)
    .filter(Boolean)
    .join('\n\n');
}

export function runGoldenScenario(scenario: GoldenScenario): GoldenRuntimeResult {
  const document = scenario.document || null;
  const messages = scenario.messages || [];
  const discoverySignals = computeDiscoverySignals(
    scenario.userMessage,
    messages,
    document,
  );
  const initialClassification = buildClassification(
    scenario.subIntent,
    scenario.classificationOverrides,
  );
  const behaviorDecision = buildBehaviorDecision({
    userMessage: scenario.userMessage,
    document,
    classification: initialClassification,
    discoveryReadiness: discoverySignals.baDiscoveryReadiness,
  });
  const sourceReport = analyzeSourceIntelligence({
    sourceText: buildSourceCorpus({
      userMessage: scenario.userMessage,
      messages,
      document,
    }),
    workspaceTitle: scenario.workspaceTitle || '',
  });
  const cognitiveFrame = buildBaCognitiveFrame({
    userMessage: scenario.userMessage,
    recentConversation: recentConversation(scenario),
    document,
    sourceReport,
    behaviorDecision,
  });
  const classification = applyBehaviorDecisionToClassification(
    initialClassification,
    behaviorDecision,
    document,
  );
  const decision = buildAiTurnDecision({
    userMessage: scenario.userMessage,
    document,
    classification,
    behaviorDecision,
    cognitiveFrame,
    sourceReport,
    discoverySignals: {
      mustGenerateNow: discoverySignals.mustGenerateNow,
      greetingOnly: discoverySignals.greetingOnly,
      newStandaloneRequest: discoverySignals.newStandaloneRequest,
      reason: discoverySignals.reason,
    },
    hasSelectedText: !!scenario.selectedText,
    capabilities: {
      zeroTouchEnabled: scenario.zeroTouchEnabled ?? false,
    },
    pendingOperation: scenario.pendingOperationId
      ? { id: scenario.pendingOperationId }
      : null,
    pendingOperationLookupPerformed: scenario.pendingOperationLookupPerformed ?? false,
  });

  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    action: decision.action,
    artifactMode: decision.artifactMode,
    artifactProfile: decision.artifactProfile.id,
    documentImpact: classification.documentImpact,
    operation: classification.operation,
    targetSection: classification.targetSection || null,
    shouldAsk: decision.questionPolicy.shouldAsk,
    maxQuestions: decision.questionPolicy.maxQuestions,
    shouldUpdateDocument: decision.documentPolicy.shouldUpdateDocument,
    visibleSections: decision.documentPolicy.visibleSections,
    allowAssumptions: decision.documentPolicy.allowAssumptions,
    requiresExternalResearch: decision.sourcePolicy.requiresExternalResearch,
    officialSourceRequired: decision.sourcePolicy.officialSourceRequired,
    canClaimVerified: decision.sourcePolicy.canClaimVerified,
    sourceSensitive: decision.sourcePolicy.sourceSensitive,
    behaviorMode: behaviorDecision.mode,
    behaviorDomain: behaviorDecision.domain,
    cognitiveAction: cognitiveFrame.action,
    sourceConfidence: sourceReport.confidence,
    decisionConfidence: decision.confidence,
    discoveryReason: discoverySignals.reason,
  };
}

export function buildSprint0Baseline(
  scenarios: GoldenScenario[] = goldenScenarios,
): Sprint0Baseline {
  const categoryCounts: Record<GoldenScenarioCategory, number> = {
    conversation: 0,
    discovery: 0,
    drafting: 0,
    revision: 0,
    research_review: 0,
    system_workflow: 0,
  };
  const results = scenarios.map((scenario) => {
    categoryCounts[scenario.category] += 1;
    return runGoldenScenario(scenario);
  });

  return {
    schemaVersion: 1,
    scenarioCount: results.length,
    categoryCounts,
    results,
  };
}
