import { describe, expect, it } from 'vitest';
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';

const plan = (): ReasoningPlan => ({
  intent: 'analysis', complexity: 'medium', goal: 'follow up', knowledgeRequired: true,
  webMode: 'none', verificationRequired: false, creativeMode: false, evidenceQueries: [], steps: [],
  executionMode: 'knowledge',
  conversationState: {
    continuation: true, topic: 'zcrmcost hatalarının tümünü listele', userMove: 'follow_up', priorIntent: 'analysis',
    rejectedHypotheses: [], retainedContext: [], openQuestions: [],
  },
});

describe('live class inventory scope examples', () => {
  for (const message of [
    'hangi classlar var',
    'sistemde bu ikisinden başka klas yok mu',
    'class envanterinde daha çok olmalıydı',
  ]) {
    it(`routes ${message} to the class inventory capability`, () => {
      const result = applyConversationScopeInventoryPolicy({
        plan: plan(), currentMessage: message,
        conversation: [{ role: 'assistant', content: 'Maliyet ve Ninja bağlamında iki class bulundu.' }],
      });
      expect(result.enumerationTarget?.tool).toBe('list_class_inventory');
      expect(result.enumerationTarget?.objectType).toBe('class');
      expect(result.conversationState?.topic).toBe('class envanteri');
    });
  }
});
