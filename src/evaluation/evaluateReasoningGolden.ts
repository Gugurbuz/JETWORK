import type { ReasoningRoute } from '../../supabase/functions/_shared/reasoningEngine';
import type { ReasoningGoldenScenario } from './reasoningGoldenScenarios';

export type GoldenSourceType = 'knowledge' | 'web';

export interface ReasoningGoldenObservedRun {
  route: ReasoningRoute;
  stages: string[];
  sources: Array<{ sourceType: GoldenSourceType; sourceName?: string; url?: string }>;
  toolCallCount: number;
  verification?: {
    verdict?: 'sufficient' | 'needs_more_evidence' | 'conflicting';
    confidence?: number;
  };
  answerText: string;
  completed: boolean;
  errorMessage?: string | null;
}

export const REASONING_GOLDEN_CRITERIA = [
  'routeAccuracy',
  'stageDiscipline',
  'knowledgePolicy',
  'webPolicy',
  'verificationPolicy',
  'toolDepth',
  'answerDiscipline',
  'completion',
] as const;

export type ReasoningGoldenCriterion = typeof REASONING_GOLDEN_CRITERIA[number];

export interface ReasoningGoldenEvaluation {
  scenarioId: string;
  score: number;
  criteria: Record<ReasoningGoldenCriterion, number>;
  hardFailures: string[];
  warnings: string[];
}

export interface ReasoningGoldenSuiteSummary {
  scenarioCount: number;
  criticalScenarioCount: number;
  averageScore: number;
  criticalAverageScore: number;
  hardFailureCount: number;
  criticalHardFailureCount: number;
  criterionScores: Record<ReasoningGoldenCriterion, number>;
  failedScenarioIds: string[];
}

const normalize = (value = '') => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

const includesConcept = (text: string, concept: string) => normalize(text).includes(normalize(concept));

const routeMatches = (scenario: ReasoningGoldenScenario, route: ReasoningRoute) => {
  const expected = scenario.expectedRoute;
  return route.intent === expected.intent
    && route.complexity === expected.complexity
    && route.knowledgeRequired === expected.knowledgeRequired
    && route.webMode === expected.webMode
    && route.verificationRequired === expected.verificationRequired
    && route.creativeMode === expected.creativeMode;
};

const stagePresent = (stages: string[], expected: string) => (
  stages.some(stage => normalize(stage) === normalize(expected))
);

const uncertaintyLanguagePresent = (text: string) => {
  const value = normalize(text);
  return [
    'bulunamadi', 'bulamadim', 'kanit yok', 'dogrulanamadi', 'yeterli kanit',
    'kesin soyleyemem', 'acik konu', 'bilgi bankasinda yok', 'kayit bulunmadi',
  ].some(marker => value.includes(marker));
};

export function evaluateReasoningRoute(
  scenario: ReasoningGoldenScenario,
  route: ReasoningRoute,
): ReasoningGoldenEvaluation {
  const routeAccuracy = routeMatches(scenario, route) ? 1 : 0;
  const hardFailures = routeAccuracy ? [] : [
    `route_mismatch:${JSON.stringify({ expected: scenario.expectedRoute, actual: route })}`,
  ];
  const criteria = Object.fromEntries(
    REASONING_GOLDEN_CRITERIA.map(criterion => [criterion, criterion === 'routeAccuracy' ? routeAccuracy : 1]),
  ) as Record<ReasoningGoldenCriterion, number>;
  return {
    scenarioId: scenario.id,
    score: routeAccuracy ? 100 : 0,
    criteria,
    hardFailures,
    warnings: [],
  };
}

export function evaluateReasoningObservedRun(
  scenario: ReasoningGoldenScenario,
  observed: ReasoningGoldenObservedRun,
): ReasoningGoldenEvaluation {
  const expected = scenario.expectedRuntime;
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const knowledgeSources = observed.sources.filter(source => source.sourceType === 'knowledge').length;
  const webSources = observed.sources.filter(source => source.sourceType === 'web').length;

  const routeAccuracy = routeMatches(scenario, observed.route) ? 1 : 0;
  if (!routeAccuracy) hardFailures.push('route_mismatch');

  const missingStages = expected.requiredStages.filter(stage => !stagePresent(observed.stages, stage));
  const forbiddenStages = (expected.forbiddenStages || []).filter(stage => stagePresent(observed.stages, stage));
  const stageDiscipline = missingStages.length === 0 && forbiddenStages.length === 0 ? 1 : 0;
  if (missingStages.length) hardFailures.push(`missing_stages:${missingStages.join(',')}`);
  if (forbiddenStages.length) warnings.push(`forbidden_stages:${forbiddenStages.join(',')}`);

  const minimumKnowledgeSources = expected.minimumKnowledgeSources ?? (scenario.expectedRoute.knowledgeRequired ? 1 : 0);
  const knowledgePolicy = knowledgeSources >= minimumKnowledgeSources ? 1 : 0;
  if (!knowledgePolicy && scenario.expectedRoute.knowledgeRequired) {
    hardFailures.push(`knowledge_evidence_missing:${knowledgeSources}/${minimumKnowledgeSources}`);
  }

  const minimumWebSources = expected.minimumWebSources ?? (scenario.expectedRoute.webMode === 'required' ? 1 : 0);
  let webPolicy = webSources >= minimumWebSources ? 1 : 0;
  if (scenario.expectedRoute.webMode === 'none' && webSources > 0) {
    webPolicy = 0;
    warnings.push(`unnecessary_web_sources:${webSources}`);
  }
  if (!webPolicy && scenario.expectedRoute.webMode === 'required') {
    hardFailures.push(`required_web_evidence_missing:${webSources}/${minimumWebSources}`);
  }

  const verificationObserved = stagePresent(observed.stages, 'verifying') || !!observed.verification?.verdict;
  const verificationPolicy = scenario.expectedRoute.verificationRequired ? Number(verificationObserved) : 1;
  if (!verificationPolicy) hardFailures.push('verification_missing');

  const minimumToolCalls = expected.minimumToolCalls || 0;
  const toolDepth = observed.toolCallCount >= minimumToolCalls ? 1 : 0;
  if (!toolDepth) hardFailures.push(`tool_depth:${observed.toolCallCount}/${minimumToolCalls}`);

  let answerDiscipline = 1;
  for (const concept of expected.requiredAnswerConcepts || []) {
    if (!includesConcept(observed.answerText, concept)) {
      answerDiscipline = 0;
      warnings.push(`required_answer_concept_missing:${concept}`);
    }
  }
  for (const concept of expected.forbiddenAnswerConcepts || []) {
    if (includesConcept(observed.answerText, concept)) {
      answerDiscipline = 0;
      hardFailures.push(`forbidden_answer_claim:${concept}`);
    }
  }
  if (
    expected.requireUncertaintyLanguageWhenNoEvidence
    && knowledgeSources === 0
    && webSources === 0
    && !uncertaintyLanguagePresent(observed.answerText)
  ) {
    answerDiscipline = 0;
    hardFailures.push('uncertainty_language_missing_without_evidence');
  }

  const completion = observed.completed && !observed.errorMessage ? 1 : 0;
  if (!completion) hardFailures.push(`runtime_not_completed:${observed.errorMessage || 'unknown'}`);

  const criteria: Record<ReasoningGoldenCriterion, number> = {
    routeAccuracy,
    stageDiscipline,
    knowledgePolicy,
    webPolicy,
    verificationPolicy,
    toolDepth,
    answerDiscipline,
    completion,
  };

  const score = Math.round(
    Object.values(criteria).reduce((total, value) => total + value, 0)
      / REASONING_GOLDEN_CRITERIA.length
      * 100,
  );

  return {
    scenarioId: scenario.id,
    score,
    criteria,
    hardFailures: [...new Set(hardFailures)],
    warnings: [...new Set(warnings)],
  };
}

export function summarizeReasoningGoldenSuite(
  entries: Array<{ scenario: ReasoningGoldenScenario; evaluation: ReasoningGoldenEvaluation }>,
): ReasoningGoldenSuiteSummary {
  const scenarioCount = entries.length;
  const criticalEntries = entries.filter(entry => entry.scenario.critical);
  const scoreOf = (values: typeof entries) => values.length
    ? Math.round(values.reduce((sum, entry) => sum + entry.evaluation.score, 0) / values.length)
    : 0;

  const criterionScores = Object.fromEntries(REASONING_GOLDEN_CRITERIA.map(criterion => [
    criterion,
    scenarioCount
      ? Math.round(entries.reduce((sum, entry) => sum + entry.evaluation.criteria[criterion], 0) / scenarioCount * 100)
      : 0,
  ])) as Record<ReasoningGoldenCriterion, number>;

  return {
    scenarioCount,
    criticalScenarioCount: criticalEntries.length,
    averageScore: scoreOf(entries),
    criticalAverageScore: scoreOf(criticalEntries),
    hardFailureCount: entries.reduce((sum, entry) => sum + entry.evaluation.hardFailures.length, 0),
    criticalHardFailureCount: criticalEntries.reduce((sum, entry) => sum + entry.evaluation.hardFailures.length, 0),
    criterionScores,
    failedScenarioIds: entries
      .filter(entry => entry.evaluation.hardFailures.length > 0)
      .map(entry => entry.scenario.id),
  };
}
