import { describe, expect, it } from 'vitest';
import { buildBehaviorDecision } from '../behaviorDecision';
import { buildClassification } from '../intentClassifier';

function decide(userMessage: string) {
  return buildBehaviorDecision({
    userMessage,
    document: null,
    discoveryReadiness: 0,
    classification: buildClassification('start_new_requirement'),
  });
}

describe('behavior decision', () => {
  it('treats a structured problem brief as context, not a document command', () => {
    const decision = decide(
      'Problem: Abonelik iptal ve iade talepleri farklı kanallarda izlenemiyor. '
      + 'Mevcut durum: Çağrı merkezi ve operasyon ekipleri ayrı listeler kullanıyor. '
      + 'Hedef durum: Talepleri tek iş listesinde izlemek ve karar geçmişini kaydetmek.',
    );

    expect(decision.mode).toBe('suggest_next_step');
    expect(decision.shouldAskQuestions).toBe(false);
    expect(decision.shouldUpdateDocument).toBe(false);
  });

  it('asks focused discovery questions for a sparse high-impact project idea', () => {
    const decision = decide('SAP CRM AI satış botu projesi');

    expect(decision.mode).toBe('ask_clarifying_questions');
    expect(decision.questionBudget).toBeLessThanOrEqual(3);
  });

  it('recognizes an explicit BA document request', () => {
    const decision = decide('İade süreci için BA analiz dokümanı hazırla');

    expect(['ask_clarifying_questions', 'draft_with_assumptions']).toContain(decision.mode);
    expect(decision.requiredTemplate).toBe('corporate_conceptual_design');
  });
});
