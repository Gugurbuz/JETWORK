import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.99.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const clean = (value: unknown, max = 20_000) => String(value ?? '').trim().slice(0, max);
const lower = (value: unknown) => clean(value, 100_000).toLocaleLowerCase('tr-TR');
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

interface QualityStep {
  id: string;
  step_no: number;
  message: string;
}

interface QualityAssertion {
  id: string;
  position: number;
  target_step: number | null;
  kind: string;
  field: string | null;
  expected_text: string | null;
  expected_number: number | null;
  required: boolean;
  enabled: boolean;
}

interface QualityScenario {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  model: string;
  project_id: string | null;
  steps: QualityStep[];
  assertions: QualityAssertion[];
}

interface AssistantStepResult {
  stepNo: number;
  userText: string;
  responseText: string;
  status: string;
  sources: Array<Record<string, unknown>>;
  usage: Record<string, number>;
  durationMs: number;
  model?: string;
  provider?: string;
  toolCalls: number;
  turnId?: string;
}

function parseSse(raw: string) {
  let text = '';
  let sources: Array<Record<string, unknown>> = [];
  let usage: Record<string, number> = {};
  let model = '';
  let provider = '';
  let error = '';
  for (const frame of raw.split(/\r?\n\r?\n/u)) {
    const lines = frame.split(/\r?\n/u);
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || '';
    const dataText = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!dataText || dataText === '[DONE]') continue;
    let data: any;
    try { data = JSON.parse(dataText); } catch { continue; }
    if (event === 'text_delta' || data?.type === 'text_delta') text += clean(data?.delta, 200_000);
    if (event === 'sources' || data?.type === 'sources') sources = Array.isArray(data?.sources) ? data.sources : sources;
    if (event === 'completed' || data?.type === 'completed') {
      usage = data?.usage && typeof data.usage === 'object' ? data.usage : usage;
      model = clean(data?.model, 120) || model;
      provider = clean(data?.provider, 40) || provider;
    }
    if (event === 'error' || data?.type === 'error') error = clean(data?.message, 2_000) || 'Assistant error';
  }
  return { text: text.trim(), sources, usage, model, provider, error };
}

function evaluateAssertion(assertion: QualityAssertion, step: AssistantStepResult) {
  const expectedText = assertion.expected_text || '';
  const expectedNumber = assertion.expected_number == null ? null : Number(assertion.expected_number);
  let passed = false;
  let actual: unknown = null;
  try {
    switch (assertion.kind) {
      case 'contains':
        actual = step.responseText;
        passed = lower(step.responseText).includes(lower(expectedText));
        break;
      case 'not_contains':
        actual = step.responseText;
        passed = !lower(step.responseText).includes(lower(expectedText));
        break;
      case 'regex':
        actual = step.responseText;
        passed = new RegExp(expectedText, 'iu').test(step.responseText);
        break;
      case 'source_canonical':
        actual = step.sources.map(source => source.canonicalKey || source.canonical_key).filter(Boolean);
        passed = (actual as unknown[]).some(value => lower(value) === lower(expectedText));
        break;
      case 'source_name':
        actual = step.sources.map(source => source.sourceName || source.source_name).filter(Boolean);
        passed = (actual as unknown[]).some(value => lower(value).includes(lower(expectedText)));
        break;
      case 'usage_lte': {
        actual = numberValue(step.usage[assertion.field || '']);
        passed = expectedNumber != null && Number(actual) <= expectedNumber;
        break;
      }
      case 'usage_gte': {
        actual = numberValue(step.usage[assertion.field || '']);
        passed = expectedNumber != null && Number(actual) >= expectedNumber;
        break;
      }
      case 'status':
        actual = step.status;
        passed = lower(step.status) === lower(expectedText || 'completed');
        break;
      case 'model_is':
        actual = step.model || '';
        passed = lower(actual) === lower(expectedText);
        break;
      case 'provider_is':
        actual = step.provider || '';
        passed = lower(actual) === lower(expectedText);
        break;
      default:
        actual = 'unsupported assertion';
        passed = false;
    }
  } catch (error) {
    actual = error instanceof Error ? error.message : String(error);
    passed = false;
  }
  return {
    assertionId: assertion.id,
    kind: assertion.kind,
    field: assertion.field,
    targetStep: assertion.target_step,
    expectedText: assertion.expected_text,
    expectedNumber: assertion.expected_number,
    actual,
    required: assertion.required,
    passed,
  };
}

async function loadScenarios(service: any, input: { suiteId?: string; suiteSlug?: string; scenarioIds?: string[] }) {
  let scenarioIds = Array.isArray(input.scenarioIds) ? input.scenarioIds.filter(Boolean) : [];
  let suite: any = null;
  if (!scenarioIds.length && (input.suiteId || input.suiteSlug)) {
    let query = service.from('ai_quality_suites').select('id,slug,name,enabled');
    query = input.suiteId ? query.eq('id', input.suiteId) : query.eq('slug', input.suiteSlug);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Quality suite bulunamadı.');
    suite = data;
    const { data: cases, error: caseError } = await service
      .from('ai_quality_suite_cases')
      .select('scenario_id,position')
      .eq('suite_id', data.id)
      .eq('enabled', true)
      .order('position');
    if (caseError) throw caseError;
    scenarioIds = (cases || []).map((row: any) => String(row.scenario_id));
  }
  if (!scenarioIds.length) throw new Error('Çalıştırılacak kalite senaryosu yok.');

  const { data: scenarioRows, error: scenarioError } = await service
    .from('ai_quality_scenarios')
    .select('*')
    .in('id', scenarioIds)
    .eq('enabled', true);
  if (scenarioError) throw scenarioError;
  const rows = scenarioRows || [];
  const order = new Map(scenarioIds.map((id, index) => [id, index]));
  rows.sort((a: any, b: any) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));

  const { data: steps, error: stepError } = await service
    .from('ai_quality_steps').select('*').in('scenario_id', scenarioIds).order('step_no');
  if (stepError) throw stepError;
  const { data: assertions, error: assertionError } = await service
    .from('ai_quality_assertions').select('*').in('scenario_id', scenarioIds).eq('enabled', true).order('position');
  if (assertionError) throw assertionError;

  return {
    suite,
    scenarios: rows.map((row: any) => ({
      ...row,
      steps: (steps || []).filter((step: any) => step.scenario_id === row.id),
      assertions: (assertions || []).filter((assertion: any) => assertion.scenario_id === row.id),
    })) as QualityScenario[],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Only POST is supported.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceKey || !authorization) return json({ error: 'Runner configuration/authentication missing.' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Authentication required.' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const endpoint = clean(body?.endpoint || 'openai-assistant-v2', 100);
  if (!/^openai-assistant(?:-v2)?$/u.test(endpoint)) return json({ error: 'Unsupported assistant endpoint.' }, 400);
  const trigger = ['ui','ci','schedule','manual','assistant'].includes(body?.trigger) ? body.trigger : 'ui';

  try {
    const loaded = await loadScenarios(service, {
      suiteId: clean(body?.suiteId, 100) || undefined,
      suiteSlug: clean(body?.suiteSlug, 100) || undefined,
      scenarioIds: Array.isArray(body?.scenarioIds) ? body.scenarioIds.map((id: unknown) => clean(id, 100)) : undefined,
    });

    const { data: run, error: runError } = await service.from('ai_quality_runs').insert({
      suite_id: loaded.suite?.id || null,
      requested_by: authData.user.id,
      trigger,
      endpoint,
      status: 'running',
      total_cases: loaded.scenarios.length,
      started_at: new Date().toISOString(),
      metadata: { suiteSlug: loaded.suite?.slug || null },
    }).select('*').single();
    if (runError) throw runError;

    let passedCases = 0;
    let failedCases = 0;
    let totalCost = 0;
    let totalDuration = 0;
    const caseResults: any[] = [];

    for (const scenario of loaded.scenarios) {
      const workspaceId = crypto.randomUUID();
      const caseStarted = performance.now();
      const { data: runCase, error: runCaseError } = await service.from('ai_quality_run_cases').insert({
        run_id: run.id,
        scenario_id: scenario.id,
        workspace_id: workspaceId,
        status: 'running',
      }).select('*').single();
      if (runCaseError) throw runCaseError;

      const { error: workspaceError } = await service.from('workspaces').insert({
        id: workspaceId,
        project_id: scenario.project_id || null,
        item_number: `QL-${Date.now()}`,
        title: `[Quality] ${scenario.name}`,
        owner_id: authData.user.id,
        collaborators: [],
        document: {},
        type: 'quality_test',
        status: 'active',
      });
      if (workspaceError) throw workspaceError;

      const stepResults: AssistantStepResult[] = [];
      let caseError = '';
      try {
        for (const step of scenario.steps) {
          const messageId = `quality-${crypto.randomUUID()}`;
          const started = performance.now();
          const { error: messageInsertError } = await service.from('messages').insert({
            id: messageId,
            workspace_id: workspaceId,
            sender_name: authData.user.email || 'Quality Runner',
            sender_role: 'user',
            text: step.message,
            is_ai: false,
            role: 'user',
            owner_id: authData.user.id,
            sender_id: authData.user.id,
          });
          if (messageInsertError) throw messageInsertError;

          const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
            method: 'POST',
            headers: {
              Authorization: authorization,
              apikey: anonKey,
              'Content-Type': 'application/json',
              'x-client-info': 'jetwork-ai-quality-lab/1.0',
            },
            body: JSON.stringify({
              workspaceId,
              messageId,
              message: step.message,
              model: scenario.model || 'auto',
              chatAttachments: [],
            }),
          });
          const raw = await response.text();
          const parsed = parseSse(raw);
          if (!response.ok || parsed.error) throw new Error(parsed.error || `Assistant HTTP ${response.status}`);
          const durationMs = Math.round(performance.now() - started);

          const { data: turn } = await service
            .from('assistant_turns')
            .select('id,status,response_text,source_refs,usage,response_model')
            .eq('message_id', messageId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          let toolCalls = 0;
          if (turn?.id) {
            const { count } = await service.from('assistant_tool_runs').select('id', { count: 'exact', head: true }).eq('turn_id', turn.id);
            toolCalls = count || 0;
          }
          const responseText = clean(turn?.response_text || parsed.text, 200_000);
          const sources = Array.isArray(turn?.source_refs) ? turn.source_refs : parsed.sources;
          const usage = (turn?.usage && typeof turn.usage === 'object' ? turn.usage : parsed.usage) as Record<string, number>;
          const result: AssistantStepResult = {
            stepNo: step.step_no,
            userText: step.message,
            responseText,
            status: clean(turn?.status || 'completed', 40),
            sources,
            usage,
            durationMs,
            model: clean(turn?.response_model || parsed.model, 120),
            provider: parsed.provider,
            toolCalls,
            turnId: turn?.id,
          };
          stepResults.push(result);

          await service.from('messages').insert({
            id: `quality-model-${crypto.randomUUID()}`,
            workspace_id: workspaceId,
            sender_name: 'JetWork AI',
            sender_role: 'assistant',
            text: responseText,
            is_ai: true,
            role: 'model',
            owner_id: authData.user.id,
            sender_id: 'assistant',
            knowledge_sources: sources,
            provider: parsed.provider || null,
            response_model: result.model || null,
            raw_response: responseText,
          });
        }
      } catch (error) {
        caseError = error instanceof Error ? error.message : String(error);
      }

      const assertionResults: any[] = [];
      for (const assertion of scenario.assertions) {
        const target = assertion.target_step == null
          ? stepResults[stepResults.length - 1]
          : stepResults.find(step => step.stepNo === assertion.target_step);
        if (!target) {
          assertionResults.push({ assertionId: assertion.id, kind: assertion.kind, required: assertion.required, passed: false, actual: 'target step missing' });
        } else {
          assertionResults.push(evaluateAssertion(assertion, target));
        }
      }

      for (const stepResult of stepResults) {
        const stepAssertions = assertionResults.filter(result => {
          const source = scenario.assertions.find(assertion => assertion.id === result.assertionId);
          return source && (source.target_step == null ? stepResult.stepNo === stepResults[stepResults.length - 1]?.stepNo : source.target_step === stepResult.stepNo);
        });
        await service.from('ai_quality_run_steps').insert({
          run_case_id: runCase.id,
          step_no: stepResult.stepNo,
          user_text: stepResult.userText,
          response_text: stepResult.responseText,
          status: stepResult.status,
          sources: stepResult.sources,
          usage: stepResult.usage,
          duration_ms: stepResult.durationMs,
          assertion_results: stepAssertions,
        });
      }

      const requiredAssertions = assertionResults.filter(result => result.required !== false);
      const failedRequired = requiredAssertions.filter(result => !result.passed);
      const passed = !caseError && stepResults.length === scenario.steps.length && failedRequired.length === 0;
      const caseDuration = Math.round(performance.now() - caseStarted);
      const caseCost = stepResults.reduce((sum, step) => sum + numberValue(step.usage.estimated_cost_usd), 0);
      const providerCalls = stepResults.reduce((sum, step) => sum + numberValue(step.usage.primary_llm_agent_calls) + numberValue(step.usage.primary_llm_final_calls), 0);
      const toolCalls = stepResults.reduce((sum, step) => sum + step.toolCalls, 0);
      const score = requiredAssertions.length ? Math.round(((requiredAssertions.length - failedRequired.length) / requiredAssertions.length) * 100) : (caseError ? 0 : 100);
      const failureSummary = caseError || failedRequired.map(result => `${result.kind}${result.field ? `:${result.field}` : ''}`).join(', ') || null;

      await service.from('ai_quality_run_cases').update({
        status: passed ? 'passed' : (caseError ? 'error' : 'failed'),
        duration_ms: caseDuration,
        cost_usd: caseCost,
        provider_calls: providerCalls,
        tool_calls: toolCalls,
        score,
        failure_summary: failureSummary,
        details: { assertions: assertionResults, stepCount: stepResults.length },
        completed_at: new Date().toISOString(),
      }).eq('id', runCase.id);

      await service.from('workspaces').update({
        status: 'quality_test_completed',
        deleted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      }).eq('id', workspaceId);

      if (passed) passedCases += 1; else failedCases += 1;
      totalCost += caseCost;
      totalDuration += caseDuration;
      caseResults.push({
        id: runCase.id,
        scenarioId: scenario.id,
        scenario: scenario.name,
        severity: scenario.severity,
        status: passed ? 'passed' : (caseError ? 'error' : 'failed'),
        score,
        durationMs: caseDuration,
        costUsd: caseCost,
        providerCalls,
        toolCalls,
        failureSummary,
        workspaceId,
      });
    }

    const finalStatus = failedCases > 0 ? 'failed' : 'completed';
    const { data: finalRun, error: finalRunError } = await service.from('ai_quality_runs').update({
      status: finalStatus,
      passed_cases: passedCases,
      failed_cases: failedCases,
      total_cost_usd: totalCost,
      avg_duration_ms: loaded.scenarios.length ? Math.round(totalDuration / loaded.scenarios.length) : 0,
      completed_at: new Date().toISOString(),
    }).eq('id', run.id).select('*').single();
    if (finalRunError) throw finalRunError;

    return json({ run: finalRun, cases: caseResults, suite: loaded.suite });
  } catch (error) {
    console.error('AI quality runner failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Quality run failed.' }, 500);
  }
});
