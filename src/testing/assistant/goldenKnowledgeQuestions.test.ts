import { describe, expect, it } from 'vitest';
import { ASSISTANT_KNOWLEDGE_TOOLS } from '../../../supabase/functions/_shared/assistantTools';
import { assistantGoldenQuestions } from './goldenKnowledgeQuestions';

describe('single assistant knowledge golden contract', () => {
  it('contains the five master-plan pilot questions', () => {
    expect(assistantGoldenQuestions.map(item => item.question)).toEqual([
      'ZCRM2-338 nedir?',
      'CHECK_KACAK_POD ne yapıyor?',
      'ZBIL_CS_POD_OPERAND nerede çağrılıyor?',
      'CHECK_ZTKS hangi mesajları üretiyor?',
      'ZCRM2-545 hangi koşulda alınır?',
    ]);
  });

  it('exposes every primary tool required by the pilot questions', () => {
    const toolNames = new Set<string>(ASSISTANT_KNOWLEDGE_TOOLS.map(tool => tool.name));
    for (const scenario of assistantGoldenQuestions) {
      expect(toolNames.has(scenario.expectedPrimaryTool)).toBe(true);
    }
  });

  it('keeps every model-facing knowledge function in strict mode', () => {
    for (const tool of ASSISTANT_KNOWLEDGE_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(new Set(tool.parameters.required)).toEqual(
        new Set(Object.keys(tool.parameters.properties)),
      );
    }
  });
});
