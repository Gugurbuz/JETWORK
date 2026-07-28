import type { DocumentData, Message } from '../../types';
import type { AiTurnAction, AiTurnDecision } from '../../services/ai/aiTurnDecision';
import type { SubIntent, IntentClassification } from '../../services/ai/intentTypes';

export type GoldenScenarioCategory =
  | 'conversation'
  | 'discovery'
  | 'drafting'
  | 'revision'
  | 'research_review'
  | 'system_workflow';

export interface GoldenScenario {
  id: string;
  title: string;
  category: GoldenScenarioCategory;
  userMessage: string;
  subIntent: SubIntent;
  classificationOverrides?: Partial<IntentClassification>;
  document?: DocumentData | null;
  messages?: Message[];
  workspaceTitle?: string;
  selectedText?: string | null;
  zeroTouchEnabled?: boolean;
  pendingOperationLookupPerformed?: boolean;
  pendingOperationId?: string | null;
  expectedAction: AiTurnAction;
}

export interface GoldenRuntimeResult {
  id: string;
  title: string;
  category: GoldenScenarioCategory;
  action: AiTurnAction;
  artifactMode: AiTurnDecision['artifactMode'];
  artifactProfile: AiTurnDecision['artifactProfile']['id'];
  documentImpact: IntentClassification['documentImpact'];
  operation: IntentClassification['operation'];
  targetSection: IntentClassification['targetSection'] | null;
  shouldAsk: boolean;
  maxQuestions: number;
  shouldUpdateDocument: boolean;
  visibleSections: AiTurnDecision['documentPolicy']['visibleSections'];
  allowAssumptions: boolean;
  requiresExternalResearch: boolean;
  officialSourceRequired: boolean;
  canClaimVerified: boolean;
  sourceSensitive: boolean;
  behaviorMode: string;
  behaviorDomain: string;
  cognitiveAction: string;
  sourceConfidence: number;
  decisionConfidence: number;
  discoveryReason: string;
}

export interface Sprint0Baseline {
  schemaVersion: 1;
  scenarioCount: number;
  categoryCounts: Record<GoldenScenarioCategory, number>;
  results: GoldenRuntimeResult[];
}
