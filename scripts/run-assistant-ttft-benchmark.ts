import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const env = process.env;
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
const username = env.E2E_USERNAME || '';
const password = env.E2E_PASSWORD || '';
const endpoint = env.ASSISTANT_TTFT_ENDPOINT || 'openai-assistant-v2';
const outputPath = resolve(env.ASSISTANT_TTFT_OUTPUT || 'evaluation/results/assistant-ttft-benchmark.json');

if (!anonKey || !username || !password) {
  throw new Error('TTFT benchmark requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.');
}

const defaultScenarios = [
  {
    key: 'clarification_fast_path',
    prompt: 'Bir talebim var; proje mi support konusu mu olduğunu birlikte netleştirelim.',
  },
  {
    key: 'short_direct_answer',
    prompt: 'UI/UX testi: Merhaba. Lütfen yalnızca iki kısa cümleyle yanıt ver.',
  },
  {
    key: 'sap_c4c_analysis',
    prompt: 'sap crm ve c4c sistemi arasında hızlı teklif oluşturma toolu',
  },
];

const scenarios = (() => {
  const raw = env.ASSISTANT_TTFT_SCENARIOS_JSON;
  if (!raw) return defaultScenarios;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('ASSISTANT_TTFT_SCENARIOS_JSON must be a non-empty array.');
  return parsed.map((item, index) => ({
    key: String(item?.key || `scenario_${index + 1}`),
    prompt: String(item?.prompt || '').trim(),
  })).filter(item => item.prompt);
})();

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input;
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input });
  if (error || !data) throw new Error(`TTFT benchmark username could not be resolved: ${error?.message || input}`);
  return String(data);
};

const createWorkspace = async (user: { id: string; email?: string | null }) => {
  const projectId = randomUUID();
  const workspaceId = randomUUID();
  const now = new Date().toISOString();
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: 'Assistant TTFT Benchmark',
    description: 'Automated production TTFT benchmark workspace',
    owner_id: user.id,
    created_at: now,
    last_updated: now,
  });
  if (projectError) throw projectError;

  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `TTFT-${workspaceId.slice(0, 4).toUpperCase()}`,
    title: 'Assistant TTFT Benchmark',
    type: 'Development',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'TTFT Benchmark',
      email: user.email || null,
      role: 'Kurucu',
      color: '#4f46e5',
    }],
    created_at: now,
    last_updated: now,
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

type StreamEvent = {
  atMs: number;
  event: string;
  type: string;
  stage?: string;
  label?: string;
  model?: string;
  provider?: string;
  usage?: Record<string, number>;
};

const parseFrame = (frame: string, atMs: number): StreamEvent | null => {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return { atMs, event: 'done', type: 'done' };
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    const usage = payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage)
      ? Object.fromEntries(Object.entries(payload.usage as Record<string, unknown>)
        .map(([key, value]) => [key, Number(value)])
        .filter(([, value]) => Number.isFinite(value))) as Record<string, number>
      : undefined;
    return {
      atMs,
      event,
      type: String(payload.type || event),
      stage: payload.stage ? String(payload.stage) : undefined,
      label: payload.label ? String(payload.label) : undefined,
      model: payload.model ? String(payload.model) : undefined,
      provider: payload.provider ? String(payload.provider) : undefined,
      usage,
    };
  } catch {
    return null;
  }
};

const readEvents = async (response: Response, startedAt: number) => {
  if (!response.body) throw new Error('TTFT endpoint returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';
    const atMs = Date.now() - startedAt;
    for (const part of parts) {
      const parsed = parseFrame(part, atMs);
      if (parsed) events.push(parsed);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseFrame(buffer, Date.now() - startedAt);
    if (parsed) events.push(parsed);
  }
  return events;
};

const loadTurn = async (messageId: string) => {
  const { data, error } = await supabase
    .from('assistant_turns')
    .select('id,message_id,status,response_model,created_at,completed_at,usage')
    .eq('message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { turn: null, error: error.message };
  return { turn: data as any, error: null };
};

const email = await resolveEmail(username);
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !authData.session || !authData.user) {
  throw new Error(`TTFT benchmark login failed: ${authError?.message || 'no session'}`);
}

const { projectId, workspaceId } = await createWorkspace(authData.user);
const results: any[] = [];
let fatalError: unknown = null;

try {
  for (const scenario of scenarios) {
    const messageId = randomUUID();
    const sendStartedAt = Date.now();
    const userCreatedAt = new Date(sendStartedAt).toISOString();

    const { error: messageError } = await supabase.from('messages').insert({
      id: messageId,
      workspace_id: workspaceId,
      sender_name: authData.user.email?.split('@')[0] || 'TTFT Benchmark',
      sender_role: 'Kullanıcı',
      text: scenario.prompt,
      is_ai: false,
      role: 'user',
      owner_id: authData.user.id,
      attachments: [],
      reactions: [],
      grounding_urls: [],
      questions: [],
      created_at: userCreatedAt,
    });
    if (messageError) throw new Error(`${scenario.key}: message persist failed: ${messageError.message}`);

    const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authData.session.access_token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        workspaceId,
        messageId,
        message: scenario.prompt,
        model: 'auto',
        chatAttachments: [],
      }),
    });
    if (!response.ok) {
      throw new Error(`${scenario.key}: endpoint ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }

    const events = await readEvents(response, sendStartedAt);
    const totalMs = Date.now() - sendStartedAt;
    const firstStatus = events.find(item => item.type === 'status');
    const firstText = events.find(item => item.type === 'text_delta');
    const completed = [...events].reverse().find(item => item.type === 'completed');

    // The durable turn is persisted before the stream completes. A short retry
    // handles replication/transaction visibility without affecting measured TTFT.
    let turnResult = await loadTurn(messageId);
    for (let attempt = 0; !turnResult.turn && attempt < 4; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
      turnResult = await loadTurn(messageId);
    }

    const turn = turnResult.turn;
    const usage = (turn?.usage && typeof turn.usage === 'object') ? turn.usage as Record<string, number> : (completed?.usage || {});
    const turnCreatedFromSendMs = turn?.created_at
      ? Math.max(0, Date.parse(String(turn.created_at)) - sendStartedAt)
      : null;
    const backendCompletedFromSendMs = turn?.completed_at
      ? Math.max(0, Date.parse(String(turn.completed_at)) - sendStartedAt)
      : null;

    results.push({
      key: scenario.key,
      prompt: scenario.prompt,
      messageId,
      firstStatusMs: firstStatus?.atMs ?? null,
      firstTextMs: firstText?.atMs ?? null,
      totalMs,
      turnCreatedFromSendMs,
      backendCompletedFromSendMs,
      responseModel: turn?.response_model || completed?.model || null,
      provider: completed?.provider || null,
      providerFirstTextMs: Number.isFinite(Number(usage?.gemini_provider_first_text_ms))
        ? Number(usage.gemini_provider_first_text_ms)
        : null,
      providerTotalMs: Number.isFinite(Number(usage?.gemini_provider_total_ms))
        ? Number(usage.gemini_provider_total_ms)
        : null,
      estimatedCostUsd: Number.isFinite(Number(usage?.estimated_cost_usd))
        ? Number(usage.estimated_cost_usd)
        : 0,
      deterministicFastPath: Number(usage?.deterministic_fast_path || 0) === 1,
      turnLookupError: turnResult.error,
      eventCount: events.length,
    });

    await new Promise(resolve => setTimeout(resolve, 250));
  }
} catch (error) {
  fatalError = error;
} finally {
  await cleanupWorkspace(projectId, workspaceId);
}

const numeric = (values: Array<number | null | undefined>) => values.filter((value): value is number => Number.isFinite(value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const p95 = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

const firstTextValues = numeric(results.map(item => item.firstTextMs));
const turnCreatedValues = numeric(results.map(item => item.turnCreatedFromSendMs));
const totalValues = numeric(results.map(item => item.totalMs));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  endpoint,
  scenarioCount: results.length,
  summary: {
    averageFirstTextMs: average(firstTextValues),
    p95FirstTextMs: p95(firstTextValues),
    averageTurnCreatedMs: average(turnCreatedValues),
    p95TurnCreatedMs: p95(turnCreatedValues),
    averageTotalMs: average(totalValues),
    totalEstimatedCostUsd: results.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0),
  },
  scenarios: results,
  fatalError: fatalError instanceof Error ? fatalError.message : fatalError ? String(fatalError) : null,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('\nAssistant TTFT benchmark');
console.table(results.map(item => ({
  scenario: item.key,
  firstTextMs: item.firstTextMs,
  turnCreatedMs: item.turnCreatedFromSendMs,
  providerFirstTextMs: item.providerFirstTextMs,
  totalMs: item.totalMs,
  model: item.responseModel,
  costUsd: item.estimatedCostUsd,
})));
console.log(JSON.stringify(report.summary, null, 2));

if (fatalError) throw fatalError;
if (results.some(item => item.firstTextMs === null)) {
  throw new Error('TTFT benchmark failed: at least one scenario produced no text_delta.');
}
