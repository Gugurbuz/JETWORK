import { IntentClassification } from './intentTypes';

export type OrchestratorActionType =
  | 'SYSTEM_MESSAGE'
  | 'ASK_CLARIFYING_QUESTIONS'
  | 'PREVIEW_DOCUMENT_CHANGE'
  | 'CHAT_ONLY'
  | 'SUGGEST_DOCUMENT_UPDATE'
  | 'RUN_RESEARCH'
  | 'UPDATE_SELECTED_TEXT'
  | 'RUN_BA_AGENT_LOOP'
  | 'UPDATE_DOCUMENT_SECTION'
  | 'MEMORY_ACTION'
  | 'WORKFLOW_ACTION';

export interface OrchestratorAction {
  type: OrchestratorActionType;
  code?: string;
  reason?: string;
}

export interface PolicyContext {
  hasSelectedText: boolean;
  zeroTouchEnabled: boolean;
}

export function decideAction(c: IntentClassification, ctx: PolicyContext): OrchestratorAction {
  if (c.subIntent === 'zero_touch_requested' && !ctx.zeroTouchEnabled) {
    return { type: 'SYSTEM_MESSAGE', code: 'ZERO_TOUCH_DISABLED' };
  }
  if (c.subIntent === 'agent_debate_requested') {
    return { type: 'SYSTEM_MESSAGE', code: 'AGENT_DEBATE_DISABLED' };
  }
  if (c.subIntent === 'missing_selection' || (c.documentImpact === 'updates_selected_text' && !ctx.hasSelectedText)) {
    return { type: 'ASK_CLARIFYING_QUESTIONS', code: 'MISSING_SELECTION' };
  }
  if (c.requiresClarification || c.confidence < 0.5) {
    return { type: 'ASK_CLARIFYING_QUESTIONS' };
  }
  if (c.riskLevel === 'high' || c.documentImpact === 'requires_user_confirmation' || c.requiresPreview) {
    return { type: 'PREVIEW_DOCUMENT_CHANGE' };
  }

  switch (c.documentImpact) {
    case 'none':
      return { type: 'CHAT_ONLY' };
    case 'suggests_update':
      return c.requiresResearch
        ? { type: 'RUN_RESEARCH' }
        : { type: 'SUGGEST_DOCUMENT_UPDATE' };
    case 'updates_selected_text':
      return { type: 'UPDATE_SELECTED_TEXT' };
    case 'updates_document':
      return c.shouldRunBaAgentLoop
        ? { type: 'RUN_BA_AGENT_LOOP' }
        : { type: 'UPDATE_DOCUMENT_SECTION' };
    case 'updates_memory_only':
      return { type: 'MEMORY_ACTION' };
    case 'workflow_action_only':
      return { type: 'WORKFLOW_ACTION' };
    default:
      return { type: 'ASK_CLARIFYING_QUESTIONS' };
  }
}
