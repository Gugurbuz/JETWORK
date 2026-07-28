import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSprint0Baseline, runGoldenScenario } from './runtimeHarness';
import { goldenScenarios } from './scenarios';
import type { Sprint0Baseline } from './types';

const baselinePath = resolve(process.cwd(), 'artifacts/sprint0/golden-baseline.json');

describe('Sprint 0 golden runtime contract', () => {
  it('contains exactly 31 uniquely named scenarios', () => {
    expect(goldenScenarios).toHaveLength(31);
    expect(new Set(goldenScenarios.map(scenario => scenario.id)).size).toBe(31);
  });

  it.each(goldenScenarios)('$id — $title', (scenario) => {
    expect(runGoldenScenario(scenario).action).toBe(scenario.expectedAction);
  });

  it('keeps the visible document surface limited to BA Analiz and Review', () => {
    for (const result of buildSprint0Baseline().results) {
      expect(result.visibleSections).toEqual(['businessAnalysis', 'review']);
    }
  });

  it('matches the reviewed deterministic Sprint 0 baseline', () => {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Sprint0Baseline;
    expect(buildSprint0Baseline()).toEqual(baseline);
  });
});
