import { describe, expect, it } from 'vitest';
import { evaluateGoldenOutput, GOLDEN_CRITERIA, summarizeGoldenEvaluation } from '../evaluateGoldenOutput';
import { GOLDEN_SCENARIOS } from '../goldenScenarios';

describe('golden scenario contract', () => {
  it('contains 30 unique scenarios split evenly between both behavior sources', () => {
    expect(GOLDEN_SCENARIOS).toHaveLength(30);
    expect(new Set(GOLDEN_SCENARIOS.map(scenario => scenario.id)).size).toBe(30);
    expect(GOLDEN_SCENARIOS.filter(scenario => scenario.origin === 'AIANALYST_REFERENCE')).toHaveLength(15);
    expect(GOLDEN_SCENARIOS.filter(scenario => scenario.origin === 'JETWORK')).toHaveLength(15);
  });

  it('scores all eight rescue-plan quality criteria', () => {
    const scenario = GOLDEN_SCENARIOS.find(item => item.id === 'aianalyst-05-living-document');
    expect(scenario).toBeTruthy();
    const result = evaluateGoldenOutput(scenario!, {
      action: 'UPDATE_ARTIFACT',
      text: 'Günlük mutabakat ve operasyon uyarısı eklendi.',
      document: {
        businessAnalysis: {
          content: '# Karar\nÖdeme tamamlanınca ERP kaydı oluşturulur.\n\n# Süreç\nGünlük mutabakat başarısızsa operasyon uyarısı gönderilir.',
          status: 'DRAFT',
          flags: [],
        },
      },
    });

    expect(Object.keys(result.criteria)).toEqual([...GOLDEN_CRITERIA]);
    expect(result.actionMatched).toBe(true);
    expect(result.criteria.previousDecisionPreservation).toBe(1);
    expect(summarizeGoldenEvaluation([result]).scenarioCount).toBe(1);
  });
});
