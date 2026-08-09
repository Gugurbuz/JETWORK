import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const env = process.env;
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
const username = env.E2E_USERNAME || '';
const password = env.E2E_PASSWORD || '';
const endpoint = env.REASONING_CANARY_ENDPOINT || 'openai-assistant-v2';
const model = 'gemini-3.1-pro-preview';

if (!anonKey || !username || !password) {
  throw new Error('Production reasoning canary requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.');
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

interface ParsedEvent {
  event: string;
  payload: Record<string, unknown>;
}

type CanaryTurnError = Error & { canaryMessageId?: string };

const parseSse = (raw: string): ParsedEvent[] => raw
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

const createWorkspace = async (user: { id: string; email?: string | null }) => {
  const projectId = randomUUID();
  const workspaceId = randomUUID();
  const timestamp = new Date().toISOString();
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: 'Reasoning Production Continuity Canary',
    description: 'Contract-faithful Reasoning Engine v3 production continuity canary',
    owner_id: user.id,
    created_at: timestamp,
    last_updated: timestamp,
  });
  if (projectError) throw projectError;

  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `CAN-${workspaceId.slice(0, 5).toUpperCase()}`,
    title: 'Reasoning Production Continuity Canary',
    type: 'Support',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'Production Canary',
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

const persistMessage = async (input: {
  id: string;
  workspaceId: string;
  ownerId: string;
  role: 'user' | 'model';
  text: string;
}) => {
  const { error } = await supabase.from('messages').insert({
    id: input.id,
    workspace_id: input.workspaceId,
    sender_name: input.role === 'user' ? 'Production Canary' : 'JetWork AI',
    sender_role: input.role === 'user' ? 'Kullanıcı' : 'Sistem Asistanı',
    text: input.text,
    is_ai: input.role === 'model',
    attachments: [],
    reactions: [],
    created_at: new Date().toISOString(),
    role: input.role,
    owner_id: input.ownerId,
  });
  if (error) throw new Error(`Canary message could not be persisted: ${error.message}`);
};

const callAssistant = async (input: {
  token: string;
  userId: string;
  workspaceId: string;
  message: string;
}) => {
  const messageId = randomUUID();
  await persistMessage({
    id: messageId,
    workspaceId: input.workspaceId,
    ownerId: input.userId,
    role: 'user',
    text: input.message,
  });

  const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      messageId,
      message: input.message,
      model,
      chatAttachments: [],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    const failure = new Error(`Canary endpoint ${response.status}: ${raw.slice(0, 1_000)}`) as CanaryTurnError;
    failure.canaryMessageId = messageId;
    throw failure;
  }

  const events = parseSse(raw);
  let answer = '';
  let completed = false;
  let errorMessage: string | null = null;
  let responseModel = '';
  const stages: string[] = [];
  for (const item of events) {
    const type = String(item.payload.type || item.event || '');
    if (type === 'status' && item.payload.stage) stages.push(String(item.payload.stage));
    if (type === 'text_delta') answer += String(item.payload.delta || '');
    if (type === 'completed') {
      completed = true;
      responseModel = String(item.payload.model || '');
    }
    if (type === 'error') errorMessage = String(item.payload.message || 'runtime error');
  }
  if (!completed || errorMessage || !answer.trim()) {
    const failure = new Error(
      `Canary turn did not complete cleanly: completed=${completed}, error=${errorMessage || 'none'}, answerLength=${answer.length}`,
    ) as CanaryTurnError;
    failure.canaryMessageId = messageId;
    throw failure;
  }
  return { messageId, answer, responseModel, stages: [...new Set(stages)] };
};

const persistControlledAssistantHypothesis = async (input: {
  workspaceId: string;
  ownerId: string;
  text: string;
}) => persistMessage({
  id: randomUUID(),
  workspaceId: input.workspaceId,
  ownerId: input.ownerId,
  role: 'model',
  text: input.text,
});

const readReasoningDetail = async (workspaceId: string, messageId: string) => {
  const { data: runs, error: runsError } = await supabase.rpc('get_reasoning_debug_runs', {
    p_workspace_id: workspaceId,
    p_limit: 12,
    p_offset: 0,
  });
  if (runsError) throw new Error(`Canary reasoning runs unavailable: ${runsError.message}`);
  const run = (runs || []).find((candidate: any) => String(candidate.message_id || '') === messageId);
  if (!run?.run_id) throw new Error(`No reasoning run found for canary message ${messageId}.`);

  const { data: detail, error: detailError } = await supabase.rpc('get_reasoning_debug_run', {
    p_run_id: run.run_id,
  });
  if (detailError || !detail) {
    throw new Error(`Canary reasoning detail unavailable: ${detailError?.message || run.run_id}`);
  }
  return detail as Record<string, any>;
};

const printFailureDetail = async (workspaceId: string, error: CanaryTurnError) => {
  if (!error.canaryMessageId) return;
  try {
    const detail = await readReasoningDetail(workspaceId, error.canaryMessageId);
    console.error('Production reasoning failure detail:');
    console.error(JSON.stringify({
      messageId: error.canaryMessageId,
      status: detail.status,
      errorMessage: detail.errorMessage,
      turnErrorMessage: detail.turnErrorMessage,
      engineVersion: detail.engineVersion,
      intent: detail.intent,
      complexity: detail.complexity,
      fallbackUsed: detail.fallbackUsed,
      responseModel: detail.responseModel,
      toolCallCount: detail.toolCallCount,
      plan: detail.plan,
      executionTrace: detail.executionTrace,
      evidenceSummary: detail.evidenceSummary,
    }, null, 2));
  } catch (detailError) {
    console.error(`Production reasoning failure detail could not be loaded: ${detailError instanceof Error ? detailError.message : String(detailError)}`);
  }
};

const assertAdaptivePlan = (detail: Record<string, any>) => {
  const plan = detail.plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const conversationState = plan.conversationState || {};
  if (steps[0]?.id !== 'adaptive-evidence-loop') {
    throw new Error(`Expected adaptive-evidence-loop, got ${JSON.stringify(steps.map((step: any) => step?.id))}`);
  }
  if (plan.verificationRequired !== false) {
    throw new Error(`Legacy standalone verifier is still enabled: ${String(plan.verificationRequired)}`);
  }
  if (Array.isArray(plan.evidenceQueries) && plan.evidenceQueries.length > 0) {
    throw new Error(`Legacy deterministic preflight queries are still present: ${JSON.stringify(plan.evidenceQueries)}`);
  }
  if (conversationState.userMove !== 'rejection') {
    throw new Error(`Expected rejection semantic state, got ${String(conversationState.userMove)}`);
  }
  const rejected = Array.isArray(conversationState.rejectedHypotheses)
    ? conversationState.rejectedHypotheses.join(' ').toLocaleLowerCase('tr-TR')
    : '';
  if (!rejected.includes('paçal') && !rejected.includes('pacal')) {
    throw new Error(`Latest rejected hypothesis was not retained: ${rejected || '(empty)'}`);
  }
};

const email = await resolveEmail(username);
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !authData.session || !authData.user) {
  throw new Error(`Production canary login failed: ${authError?.message || 'no session'}`);
}

const { projectId, workspaceId } = await createWorkspace(authData.user);
try {
  console.log('Running production continuity turn 1...');
  const first = await callAssistant({
    token: authData.session.access_token,
    userId: authData.user.id,
    workspaceId,
    message: 'Teklife kost eklerken bir hata aldım ama hata mesajını ya da kodunu yakalayamadım sadece yakalayabildi kelime uyumsuz yazıyordu',
  });
  console.log(`  completed model=${first.responseModel} stages=${first.stages.join(',')}`);
  await persistControlledAssistantHypothesis({
    workspaceId,
    ownerId: authData.user.id,
    text: 'Büyük ihtimalle ZCRM_COST-112 vade uyumsuzluğu hatasıdır.',
  });

  console.log('Running production continuity turn 2 (reject vade)...');
  const second = await callAssistant({
    token: authData.session.access_token,
    userId: authData.user.id,
    workspaceId,
    message: 'Hayır vade hatası değildi',
  });
  console.log(`  completed model=${second.responseModel} stages=${second.stages.join(',')}`);
  await persistControlledAssistantHypothesis({
    workspaceId,
    ownerId: authData.user.id,
    text: 'Diğer olası hata ZCRM_COST-098 kodlu uyumsuz paçal offer id hatasıdır.',
  });

  console.log('Running production continuity turn 3 (reject paçal)...');
  const third = await callAssistant({
    token: authData.session.access_token,
    userId: authData.user.id,
    workspaceId,
    message: 'Hayır paçal da yazmıyordu',
  });
  console.log(`  completed model=${third.responseModel} stages=${third.stages.join(',')}`);

  const detail = await readReasoningDetail(workspaceId, third.messageId);
  assertAdaptivePlan(detail);
  console.log(JSON.stringify({
    ok: true,
    engineVersion: detail.engineVersion,
    intent: detail.intent,
    fallbackUsed: detail.fallbackUsed,
    responseModel: detail.responseModel,
    toolCallCount: detail.toolCallCount,
    orchestratorVersion: detail.plan?.orchestratorVersion,
    rejectedHypotheses: detail.plan?.conversationState?.rejectedHypotheses || [],
  }, null, 2));
} catch (error) {
  await printFailureDetail(workspaceId, error as CanaryTurnError);
  throw error;
} finally {
  await cleanupWorkspace(projectId, workspaceId);
}
