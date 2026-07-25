import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildSprint0Baseline } from '../src/testing/golden/runtimeHarness';

const outputPath = resolve(process.cwd(), 'artifacts/sprint0/golden-baseline.json');
const baseline = buildSprint0Baseline();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

console.log(`Sprint 0 baseline written: ${outputPath}`);
console.log(`Scenarios: ${baseline.scenarioCount}`);
