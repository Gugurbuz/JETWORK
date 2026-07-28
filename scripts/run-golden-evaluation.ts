import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAnalystTurnContext, renderAnalystTurnContext, toModelHistory } from '../src/services/analystContext';
import { runSingleChatOrchestrator } from '../src/services/singleChatOrchestrator';
import { buildSystemPrompt, DEFAULT_PROMPT_SETTINGS } from '../src/services/promptEngine';
import {
  evaluateGoldenOutput,
  summarizeGoldenEvaluation,
  type GoldenActualOutput,
} from '../src/evaluation/evaluateGoldenOutput';
import { GOLDEN_SCENARIOS } from '../src/evaluation/goldenScenarios';
import type { AnalystDecision } from '../src/services/ai/analystPlanner';
import type { Message } from '../src/types';
import { supabase } from '../src/supabase';

const args = process.argv.slice(2);
if (!args.includes('--confirm-live')) {
  throw new Error('Live evaluation calls the configured model. Re-run with --confirm-live.');
}

const outputArgIndex = args.indexOf('--output');
const outputPath = resolve(
  outputArgIndex >= 0 && args[outputArgIndex + 1]
    ? args[outputArgIndex + 1]
    : 'evaluation/results/jetwork-live-baseline.json',
);
const model = process.env.GOLDEN_MODEL || 'gemini-3-flash-preview';
const minimumScore = Math.max(0, Math.min(100, Number(process.env.GOLDEN_MIN_SCORE || 80)));
const requestedScenarioIds = (process.env.GOLDEN_SCENARIO_IDS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const selectedScenarios = requestedScenarioIds.length > 0
  ? GOLDEN_SCENARIOS.filter(scenario => requestedScenarioIds.includes(scenario.id))
  : GOLDEN_SCENARIOS;
const unknownScenarioIds = requestedScenarioIds.filter(
  id => !GOLDEN_SCENARIOS.some(scenario => scenario.id === id),
);
if (unknownScenarioIds.length > 0) {
  throw new Error(`Unknown golden scenario ids: ${unknownScenarioIds.join(', ')}`);
}
const limit = Math.min(
  selectedScenarios.length,
  Math.max(1, Number(process.env.GOLDEN_SCENARIO_LIMIT || selectedScenarios.length)),
);

if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  throw new Error('Live evaluation requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

const configuredAccessToken = process.env.GOLDEN_ACCESS_TOKEN;
const configuredRefreshToken = process.env.GOLDEN_REFRESH_TOKEN;
if (configuredAccessToken && configuredRefreshToken) {
  const { error } = await supabase.auth.setSession({
    access_token: configuredAccessToken,
    refresh_token: configuredRefreshToken,
  });
  if (error) throw new Error(`Golden evaluation session could not be configured: ${error.message}`);
} else {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Golden evaluation anonymous session failed: ${error.message}`);
}

const results = [];
for (const [index, scenario] of selectedScenarios.slice(0, limit).entries()) {
  const messages: Message[] = scenario.conversation
    .filter(item => item.text.trim())
    .map((item, messageIndex) => ({
      id: `${scenario.id}-${messageIndex}`,
      role: item.role,
      text: item.text,
      createdAt: messageIndex + 1,
    }));
  const turnContext = await buildAnalystTurnContext({
    userMessage: scenario.userMessage,
    messages,
    projectMemory: scenario.projectMemory,
    knowledgeBase: scenario.knowledgeBase,
    currentArtifact: scenario.currentArtifact || null,
    selectedContent: scenario.selectedContent,
    tokenBudget: 6_000,
    summarize: async older => older.map(message => `${message.role}: ${message.text}`).join('\n'),
  });
  let decision: AnalystDecision | undefined;
  const result = await runSingleChatOrchestrator({
    userMessage: scenario.userMessage,
    history: toModelHistory(turnContext.recentConversation),
    messageHistory: turnContext.recentConversation,
    documentContent: scenario.currentArtifact || null,
    selectedNodeContent: scenario.selectedContent,
    knowledgeBase: turnContext.retrievedSources,
    projectMemory: scenario.projectMemory,
    analystContext: turnContext,
    model,
    systemInstruction: buildSystemPrompt({
      role: 'SYSTEM',
      settings: DEFAULT_PROMPT_SETTINGS,
      additionalContext: renderAnalystTurnContext(turnContext),
    }),
    onPhase: () => {},
    onThinking: () => {},
    onStream: () => {},
    onDecision: nextDecision => {
      decision = nextDecision;
    },
  });
  const actual: GoldenActualOutput = {
    action: decision?.action || 'ANSWER',
    text: result.text,
    questions: result.questions,
    document: result.document,
  };
  const evaluation = evaluateGoldenOutput(scenario, actual);
  results.push({
    scenarioId: scenario.id,
    origin: scenario.origin,
    title: scenario.title,
    actual,
    evaluation,
    diagnostics: {
      intent: result.intent,
      classification: result.classification,
      turnDecision: result.turnDecision,
    },
  });
  console.log(`[${index + 1}/${limit}] ${scenario.id}: ${evaluation.score}`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  model,
  summary: summarizeGoldenEvaluation(results.map(result => result.evaluation)),
  results,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await supabase.auth.signOut();
console.log(`Golden evaluation saved to ${outputPath}`);
if (report.summary.averageScore < minimumScore) {
  throw new Error(
    `Golden evaluation score ${report.summary.averageScore} is below the required ${minimumScore}.`,
  );
}
