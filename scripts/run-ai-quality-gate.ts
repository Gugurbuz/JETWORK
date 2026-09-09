import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const loginInput = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const suiteSlug = process.env.AI_QUALITY_SUITE || 'smoke';
const endpoint = process.env.AI_QUALITY_ENDPOINT || 'openai-assistant-v2';

if (!url || !anonKey || !loginInput || !password) {
  console.error('Quality gate requires Supabase URL/key and E2E_USERNAME/E2E_PASSWORD.');
  process.exit(2);
}

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input;
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input });
  if (error || !data) {
    console.error('Quality gate username could not be resolved:', error?.message || input);
    process.exit(2);
  }
  return String(data);
};

const email = await resolveEmail(loginInput);
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !auth.session) {
  console.error('Quality gate login failed:', authError?.message || 'No session');
  process.exit(2);
}

const startedAt = Date.now();
const invokeRunner = async (body: Record<string, unknown>) => {
  const response = await fetch(`${url}/functions/v1/ai-quality-runner`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-client-info': 'jetwork-ai-quality-ci/2.0',
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok || payload?.error) {
    throw new Error(`HTTP ${response.status}${payload?.error ? ` · ${payload.error}` : raw ? ` · ${raw.slice(0, 500)}` : ''}`);
  }
  return payload;
};

const common = { endpoint, trigger: process.env.GITHUB_ACTIONS ? 'ci' : 'manual' };
const prepared = await invokeRunner({ ...common, operation: 'prepare', suiteSlug });
const runId = String(prepared?.run?.id || '');
const scenarioIds = Array.isArray(prepared?.scenarioIds) ? prepared.scenarioIds.map(String) : [];
if (!runId || !scenarioIds.length) throw new Error('Quality gate runner did not return a run and scenarios.');

let payload = prepared;
try {
  for (let index = 0; index < scenarioIds.length; index += 1) {
    console.log(`Quality gate case ${index + 1}/${scenarioIds.length}: ${scenarioIds[index]}`);
    payload = await invokeRunner({ ...common, operation: 'execute', runId, scenarioId: scenarioIds[index] });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await invokeRunner({ ...common, operation: 'fail', runId, error: message }).catch(() => undefined);
  console.error('Quality gate runner failed:', message);
  process.exit(2);
}

const run = payload.run || {};
const cases = Array.isArray(payload.cases) ? payload.cases : [];
const summary = {
  suite: suiteSlug,
  runId: run.id,
  status: run.status,
  totalCases: run.total_cases,
  passedCases: run.passed_cases,
  failedCases: run.failed_cases,
  passRate: Number(run.total_cases || 0) ? Math.round((Number(run.passed_cases || 0) / Number(run.total_cases)) * 1000) / 10 : 0,
  totalCostUsd: Number(run.total_cost_usd || 0),
  avgDurationMs: Number(run.avg_duration_ms || 0),
  wallDurationMs: Date.now() - startedAt,
  cases: cases.map((item: any) => ({
    scenario: item.scenario,
    severity: item.severity,
    status: item.status,
    score: item.score,
    costUsd: item.costUsd,
    durationMs: item.durationMs,
    providerCalls: item.providerCalls,
    toolCalls: item.toolCalls,
    failureSummary: item.failureSummary,
  })),
};

console.log(JSON.stringify(summary, null, 2));

const criticalFailures = cases.filter((item: any) => ['P0', 'P1'].includes(item.severity) && item.status !== 'passed');
if (Number(run.failed_cases || 0) > 0 || criticalFailures.length > 0) {
  console.error(`Quality gate FAIL: ${run.failed_cases || 0}/${run.total_cases || 0} failed.`);
  process.exit(1);
}

console.log(`Quality gate PASS: ${run.passed_cases || 0}/${run.total_cases || 0}.`);
