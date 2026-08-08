import { routeReasoningRequest } from '../supabase/functions/_shared/reasoningEngine';
import { evaluateReasoningRoute } from '../src/evaluation/evaluateReasoningGolden';
import { REASONING_GOLDEN_SCENARIOS } from '../src/evaluation/reasoningGoldenScenarios';

const rows = REASONING_GOLDEN_SCENARIOS.map(scenario => {
  const route = routeReasoningRequest(scenario.request, scenario.attachmentCount || 0);
  const evaluation = evaluateReasoningRoute(scenario, route);
  return { scenario, route, evaluation };
});

const total = rows.length;
const critical = rows.filter(row => row.scenario.critical);
const average = (items: typeof rows) => items.length
  ? Math.round(items.reduce((sum, row) => sum + row.evaluation.score, 0) / items.length)
  : 0;
const hardFailures = rows.flatMap(row => row.evaluation.hardFailures.map(failure => ({
  scenarioId: row.scenario.id,
  failure,
})));
const criticalHardFailures = rows
  .filter(row => row.scenario.critical)
  .flatMap(row => row.evaluation.hardFailures.map(failure => ({ scenarioId: row.scenario.id, failure })));

const categories = new Map<string, { total: number; passed: number }>();
for (const row of rows) {
  const current = categories.get(row.scenario.category) || { total: 0, passed: 0 };
  current.total += 1;
  if (!row.evaluation.hardFailures.length) current.passed += 1;
  categories.set(row.scenario.category, current);
}

console.log('');
console.log('Reasoning Quality Golden Set');
console.log('============================');
console.log(`Scenarios        : ${total}`);
console.log(`Critical         : ${critical.length}`);
console.log(`Route score      : ${average(rows)}`);
console.log(`Critical score   : ${average(critical)}`);
console.log(`Hard failures    : ${hardFailures.length}`);
console.log('');
console.log('Category coverage');
for (const [category, result] of [...categories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`- ${category.padEnd(14)} ${result.passed}/${result.total}`);
}

if (hardFailures.length) {
  console.error('');
  console.error('Golden route failures');
  for (const failure of hardFailures) console.error(`- ${failure.scenarioId}: ${failure.failure}`);
}

if (average(rows) < 100) {
  throw new Error(`Reasoning route golden score must remain 100; got ${average(rows)}.`);
}
if (average(critical) < 100 || criticalHardFailures.length) {
  throw new Error('A critical Reasoning Golden scenario regressed.');
}

console.log('');
console.log('✓ Reasoning route contract is 100/100 with zero critical hard failures.');
