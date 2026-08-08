import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { routeReasoningRequest } from '../supabase/functions/_shared/reasoningEngine';
import {
  evaluateReasoningObservedRun,
  summarizeReasoningGoldenSuite,
  type ReasoningGoldenObservedRun,
} from '../src/evaluation/evaluateReasoningGolden';
import { REASONING_GOLDEN_SCENARIOS } from '../src/evaluation/reasoningGoldenScenarios';

const env = process.env;
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
const username = env.E2E_USERNAME || '';
const password = env.E2E_PASSWORD || '';
const endpoint = env.REASONING_CANARY_ENDPOINT || 'openai-assistant-v2';
const outputPath = resolve(env.REASONING_CANARY_OUTPUT || 'evaluation/results/reasoning-live-canary.json');

if (!anonKey || !username || !password) {
  throw new Error('Reasoning live canary requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.');
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input;
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input });
  if (error || !data) throw new Error(`Canary username could not be resolved: ${error?.message || input}`);
  return String(data);
};

interface ParsedSse {
  event: string;
  payload: Record<string, unknown>;
}

const parseSseText = (raw: string): ParsedSse[] => raw
  .split(/\r?\n\r?\n/)
  .map(block => block.trim())
  .filter(Boolean)
  .flatMap(block => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return [];
    const data = dataLines.join('\n');
    if (data === '[DONE]') return [{ event: 'done', payload: {} }];
    try {
      const payload = JSON.parse(data);
      return payload && typeof payload === 'object'
        ? [{ event, payload: payload as Record<string, unknown> }]
        : [];
    } catch {
      return [];
    }
  });

const externalBlockReason = (message: string | null) => {
  const normalized = String(message || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (
    /openai api kullanim kredisi tukendi/.test(normalized)
    || /gemini api kullanim kotasi tukendi/.test(normalized)
    || /insufficient_quota|no credits remaining|quota exceeded|billing/.test(normalized)
  ) return 'provider_quota_or_billing';
  return null;
};

const createWorkspace = async (user: { id: string; email?: string | null }, label: string) => {
  const projectId = randomUUID();
  const workspaceId = randomUUID();
  const timestamp = new Date().toISOString();
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: `Golden Canary ${label}`,
    description: 'Reasoning Quality Golden Set live canary',
    owner_id: user.id,
    created_at: timestamp,
    last_updated: timestamp,
  });
  if (projectError) throw projectError;
  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `GOLD-${workspaceId.slice(0, 4).toUpperCase()}`,
    title: `Golden Canary ${label}`,
    type: 'Development',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'Golden Canary',
      email: user.email || null,
      role: 'Kurucu',
      color: '#4f46e5',
    }],
    created_at: timestamp,
    last_updated: timestamp,
  });
  if (workspaceError) {
    await supabase.from('projects').delete().eq('id', projectId);
    throw workspaceError;
  }
  return { projectId, workspaceId };
};

const cleanupWorkspace = async (projectId: string, workspaceId: string) => {
  await supabase.from('workspaces').delete().eq('id', workspaceId);
  await supabase.from('projects').delete().eq('id', projectId);
};

const runScenario = async (
  token: string,
  user: { id: string; email?: string | null },
  scenario: (typeof REASONING_GOLDEN_SCENARIOS)[number],
) => {
  const { projectId, workspaceId } = await createWorkspace(user, scenario.id);
  const messageId = randomUUID();
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        workspaceId,
        messageId,
        message: scenario.request,
        model: 'auto',
        chatAttachments: [],
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Canary endpoint ${response.status}: ${raw.slice(0, 500)}`);

    const events = parseSseText(raw);
    const stages: string[] = [];
    const sources: ReasoningGoldenObservedRun['sources'] = [];
    let answerText = '';
    let completed = false;
    let errorMessage: string | null = null;

    for (const item of events) {
      const eventType = String(item.payload.type || item.event || '');
      if (eventType === 'status' && item.payload.stage) stages.push(String(item.payload.stage));
      if (eventType === 'sources' && Array.isArray(item.payload.sources)) {
        for (const source of item.payload.sources as Array<Record<string, unknown>>) {
          sources.push({
            sourceType: source.sourceType === 'web' ? 'web' : 'knowledge',
            sourceName: source.sourceName ? String(source.sourceName) : undefined,
            url: source.url ? String(source.url) : undefined,
          });
        }
      }
      if (eventType === 'text_delta') answerText += String(item.payload.delta || '');
      if (eventType === 'completed') completed = true;
      if (eventType === 'error') errorMessage = String(item.payload.message || 'runtime error');
    }

    const route = routeReasoningRequest(scenario.request, scenario.attachmentCount || 0);
    const observed: ReasoningGoldenObservedRun = {
      route,
      stages: [...new Set(stages)],
      sources,
      toolCallCount: Math.max(
        sources.length,
        stages.includes('searching_knowledge') ? 1 : 0,
        stages.includes('searching_web') ? 1 : 0,
      ),
      verification: stages.includes('verifying') ? { verdict: 'sufficient' } : undefined,
      answerText,
      completed,
      errorMessage,
    };
    const environmentBlocked = externalBlockReason(errorMessage);
    return {
      scenario,
      observed,
      evaluation: evaluateReasoningObservedRun(scenario, observed),
      environmentBlocked,
      httpStatus: response.status,
      eventCount: events.length,
    };
  } finally {
    await cleanupWorkspace(projectId, workspaceId);
  }
};

const email = await resolveEmail(username);
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !authData.session || !authData.user) {
  throw new Error(`Reasoning canary login failed: ${authError?.message || 'no session'}`);
}

const canaryIds = ['rq-01-simple-definition', 'rq-03-sap-diagnosis-message', 'rq-11-current-official-docs'];
const scenarios = canaryIds.map(id => {
  const scenario = REASONING_GOLDEN_SCENARIOS.find(item => item.id === id);
  if (!scenario) throw new Error(`Missing canary scenario ${id}`);
  return scenario;
});

const results = [];
for (const scenario of scenarios) {
  console.log(`Running ${scenario.id}: ${scenario.title}`);
  const result = await runScenario(authData.session.access_token, authData.user, scenario);
  results.push(result);
  if (result.environmentBlocked) {
    console.log(`  BLOCKED=${result.environmentBlocked}; product runtime failed closed as expected`);
  } else {
    console.log(`  score=${result.evaluation.score} hardFailures=${result.evaluation.hardFailures.length}`);
  }
}

const evaluatedResults = results.filter(item => !item.environmentBlocked);
const summary = summarizeReasoningGoldenSuite(evaluatedResults.map(item => ({
  scenario: item.scenario,
  evaluation: item.evaluation,
})));
const blocked = results
  .filter(item => item.environmentBlocked)
  .map(item => ({ scenarioId: item.scenario.id, reason: item.environmentBlocked }));
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  endpoint,
  summary,
  environmentBlockedCount: blocked.length,
  environmentBlocked: blocked,
  results: results.map(item => ({
    scenarioId: item.scenario.id,
    title: item.scenario.title,
    critical: item.scenario.critical,
    environmentBlocked: item.environmentBlocked,
    route: item.observed.route,
    stages: item.observed.stages,
    sourceCounts: {
      knowledge: item.observed.sources.filter(source => source.sourceType === 'knowledge').length,
      web: item.observed.sources.filter(source => source.sourceType === 'web').length,
    },
    completed: item.observed.completed,
    errorMessage: item.observed.errorMessage,
    evaluation: item.evaluation,
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Reasoning canary report written to ${outputPath}`);
console.log(JSON.stringify({ summary, environmentBlocked: blocked }, null, 2));

const evaluatedCritical = evaluatedResults.filter(item => item.scenario.critical);
if (evaluatedCritical.length < 2) {
  throw new Error(`Reasoning live canary has too few evaluated critical scenarios: ${evaluatedCritical.length}.`);
}
if (summary.criticalHardFailureCount > 0 || summary.criticalAverageScore < 85) {
  throw new Error(
    `Reasoning live canary failed: criticalScore=${summary.criticalAverageScore}, hardFailures=${summary.criticalHardFailureCount}`,
  );
}
