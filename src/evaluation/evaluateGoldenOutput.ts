import type { DocumentData, Question } from '../types';
import type { AnalystAction } from '../services/ai/analystPlanner';
import type { GoldenScenario } from './goldenScenarios';

export const GOLDEN_CRITERIA = [
  'contextPreservation',
  'avoidsUnnecessaryQuestions',
  'capturesCriticalGaps',
  'businessRuleQuality',
  'factAssumptionSeparation',
  'processDepth',
  'documentConsistency',
  'previousDecisionPreservation',
] as const;

export type GoldenCriterion = typeof GOLDEN_CRITERIA[number];

export interface GoldenActualOutput {
  action: AnalystAction;
  text: string;
  questions?: Question[];
  document?: DocumentData | null;
}

export interface GoldenEvaluationResult {
  scenarioId: string;
  actionMatched: boolean;
  criteria: Record<GoldenCriterion, number>;
  score: number;
  failures: string[];
}

const normalize = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

const documentText = (document?: DocumentData | null): string => {
  if (!document) return '';
  return [
    document.businessAnalysis?.content,
    document.review?.content,
  ].filter(Boolean).join('\n');
};

const includesAll = (haystack: string, needles: string[] = []): boolean => (
  needles.every(needle => normalize(haystack).includes(normalize(needle)))
);

const processDepth = (text: string): number => {
  const normalized = normalize(text);
  return [
    /surec/,
    /adim/,
    /tetikleyici/,
    /istisna|hata/,
    /alternatif akis|ret/,
    /sonuc|cikti/,
  ].filter(pattern => pattern.test(normalized)).length;
};

export function evaluateGoldenOutput(
  scenario: GoldenScenario,
  actual: GoldenActualOutput,
): GoldenEvaluationResult {
  const expected = scenario.expectation;
  const combined = [actual.text, documentText(actual.document)].filter(Boolean).join('\n');
  const questionText = (actual.questions || []).map(question => (
    `${question.text} ${(question.options || []).join(' ')}`
  )).join('\n');
  const searchable = `${combined}\n${questionText}`;
  const failures: string[] = [];
  const actionMatched = expected.allowedActions.includes(actual.action);
  const preserved = includesAll(combined, expected.preserveDecisions);
  const artifactShapeMatched = expected.artifactExpected
    ? !!actual.document?.businessAnalysis
    : !actual.document;

  const criteria: Record<GoldenCriterion, number> = {
    contextPreservation: includesAll(searchable, expected.requiredConcepts) ? 1 : 0,
    avoidsUnnecessaryQuestions: (
      (actual.questions?.length || 0) <= expected.maxQuestions
      && (expected.maxQuestions > 0 || actual.action !== 'ASK')
    ) ? 1 : 0,
    capturesCriticalGaps: includesAll(searchable, expected.criticalGaps) ? 1 : 0,
    businessRuleQuality: includesAll(combined, expected.businessRules) ? 1 : 0,
    factAssumptionSeparation: !expected.separateAssumptionsAndFacts || (
      /\bvarsayim\b/.test(normalize(combined))
      && /\bacik konu\b|\bgercek\b|\bdogrulan/.test(normalize(combined))
    ) ? 1 : 0,
    processDepth: processDepth(combined) >= (expected.minimumProcessDepth || 0) ? 1 : 0,
    documentConsistency: actionMatched && artifactShapeMatched ? 1 : 0,
    previousDecisionPreservation: preserved ? 1 : 0,
  };

  if (!actionMatched) failures.push(`Eylem uyumsuz: ${actual.action}`);
  for (const criterion of GOLDEN_CRITERIA) {
    if (!criteria[criterion]) failures.push(criterion);
  }

  const score = Math.round(
    Object.values(criteria).reduce((total, value) => total + value, 0)
      / GOLDEN_CRITERIA.length
      * 100,
  );

  return {
    scenarioId: scenario.id,
    actionMatched,
    criteria,
    score,
    failures,
  };
}

export function summarizeGoldenEvaluation(results: GoldenEvaluationResult[]) {
  const scenarioCount = results.length;
  const criterionScores = Object.fromEntries(GOLDEN_CRITERIA.map(criterion => [
    criterion,
    scenarioCount
      ? Math.round(results.reduce((sum, result) => sum + result.criteria[criterion], 0) / scenarioCount * 100)
      : 0,
  ])) as Record<GoldenCriterion, number>;

  return {
    scenarioCount,
    averageScore: scenarioCount
      ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / scenarioCount)
      : 0,
    actionAccuracy: scenarioCount
      ? Math.round(results.filter(result => result.actionMatched).length / scenarioCount * 100)
      : 0,
    criterionScores,
    failedScenarioIds: results.filter(result => result.failures.length).map(result => result.scenarioId),
  };
}
