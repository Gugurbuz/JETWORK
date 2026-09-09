import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const loginInput = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const suiteSlug = process.env.AI_QUALITY_SUITE || 'smoke';
const endpoint = process.env.AI_QUALITY_ENDPOINT || 'openai-assistant-v2';
const requestedConcurrency = Number(process.env.AI_QUALITY_CONCURRENCY || 3);
const concurrency = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(Math.trunc(requestedConcurrency), 4))
  : 3;

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

const { data: suite, error: suiteError } = await supabase
  .from('ai_quality_suites')
  .select('id,slug,name')
  .eq('slug', suiteSlug)
  .eq('enabled', true)
  .maybeSingle();
if (suiteError || !suite) {
  console.error('Quality gate suite lookup failed:', suiteError?.message || suiteSlug);
  process.exit(2);
}

const { data: suiteCases, error: suiteCasesError } = await supabase
  .from('ai_quality_suite_cases')
  .select('scenario_id,position')
  .eq('suite_id', suite.id)
  .eq('enabled', true)
  .order('position');
if (suiteCasesError) {
  console.error('Quality gate suite cases lookup failed:', suiteCasesError.message);
  process.exit(2);
}

const scenarioIds = [...new Set((suiteCases || []).map(item => String(item.scenario_id)).filter(Boolean))];
if (!scenarioIds.length) {
  console.error(`Quality gate suite ${suiteSlug} has no enabled scenarios.`);
  process.exit(2);
}

const startedAt = Date.now();
const trigger = process.env.GITHUB_ACTIONS ? 'ci' : 'manual';
const runIds: string[] = [];
const cases: any[] = new Array(scenarioIds.length);
const infraErrors: Array<{ scenarioId: string; error: string }> = [];
let nextIndex = 0;

const runScenario = async (scenarioId: string, index: number) => {
  const response = await fetch(`${url}/functions/v1/ai-quality-runner`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.session.access_token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
      'x-client-info': 'jetwork-ai-quality-ci/2.0',
    },
    body: JSON.stringify({ scenarioIds: [scenarioId], endpoint, trigger }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  if (payload?.run?.id) runIds.push(String(payload.run.id));
  const item = Array.isArray(payload?.cases) ? payload.cases[0] : null;
  if (!item) throw new Error('Runner returned no case result.');
  cases[index] = item;
};

const worker = async () => {
  while (true) {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= scenarioIds.length) return;
    const scenarioId = scenarioIds[index];
    try {
      await runScenario(scenarioId, index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      infraErrors.push({ scenarioId, error: message });
      cases[index] = {
        scenarioId,
        scenario: scenarioId,
        severity: 'P0',
        status: 'error',
        score: 0,
        costUsd: 0,
        durationMs: 0,
        providerCalls: 0,
        toolCalls: 0,
        failureSummary: `runner: ${message}`,
      };
    }
  }
};

await Promise.all(Array.from({ length: Math.min(concurrency, scenarioIds.length) }, () => worker()));

const completedCases = cases.filter(Boolean);
const passedCases = completedCases.filter(item => item.status === 'passed').length;
const failedCases = completedCases.length - passedCases;
const totalCostUsd = completedCases.reduce((sum, item) => sum + Number(item.costUsd || 0), 0);
const avgDurationMs = completedCases.length
  ? Math.round(completedCases.reduce((sum, item) => sum + Number(item.durationMs || 0), 0) / completedCases.length)
  : 0;
const summary = {
  suite: suiteSlug,
  runIds,
  status: failedCases > 0 || infraErrors.length > 0 ? 'failed' : 'completed',
  totalCases: scenarioIds.length,
  passedCases,
  failedCases,
  passRate: scenarioIds.length ? Math.round((passedCases / scenarioIds.length) * 1000) / 10 : 0,
  totalCostUsd,
  avgDurationMs,
  wallDurationMs: Date.now() - startedAt,
  concurrency,
  infraErrors,
  cases: completedCases.map((item: any) => ({
    scenario: item.scenario,
    scenarioId: item.scenarioId,
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

const criticalFailures = completedCases.filter((item: any) => ['P0', 'P1'].includes(item.severity) && item.status !== 'passed');
if (infraErrors.length > 0 || failedCases > 0 || criticalFailures.length > 0) {
  console.error(`Quality gate FAIL: ${failedCases}/${scenarioIds.length} failed; ${infraErrors.length} infrastructure errors.`);
  process.exit(1);
}

console.log(`Quality gate PASS: ${passedCases}/${scenarioIds.length}.`);
