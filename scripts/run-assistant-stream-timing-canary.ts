import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const env = process.env;
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://bpbbvjigostgrssnduhk.supabase.co';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';
const username = env.E2E_USERNAME || '';
const password = env.E2E_PASSWORD || '';
const endpoint = env.ASSISTANT_TIMING_ENDPOINT || 'openai-assistant-v2';
const outputPath = resolve(env.ASSISTANT_TIMING_OUTPUT || 'evaluation/results/assistant-stream-timing-canary.json');
const requestText = env.ASSISTANT_TIMING_PROMPT
  || 'Önceki konuşma bağlamını kullanarak bu çalışma alanında nerede kaldığımızı ve açık kalan işi kısaca özetle.';

if (!anonKey || !username || !password) {
  throw new Error('Assistant stream timing canary requires VITE_SUPABASE_ANON_KEY, E2E_USERNAME and E2E_PASSWORD.');
}

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resolveEmail = async (input: string) => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return input;
  const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input });
  if (error || !data) throw new Error(`Timing canary username could not be resolved: ${error?.message || input}`);
  return String(data);
};

const createWorkspace = async (user: { id: string; email?: string | null }) => {
  const projectId = randomUUID();
  const workspaceId = randomUUID();
  const now = new Date().toISOString();
  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: 'Assistant Stream Timing Canary',
    description: 'Observable assistant progress timing canary',
    owner_id: user.id,
    created_at: now,
    last_updated: now,
  });
  if (projectError) throw projectError;
  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `TIME-${workspaceId.slice(0, 4).toUpperCase()}`,
    title: 'Assistant Stream Timing Canary',
    type: 'Development',
    status: 'Draft',
    owner_id: user.id,
    collaborators: [{
      id: user.id,
      name: user.email?.split('@')[0] || 'Timing Canary',
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

interface TimedEvent {
  atMs: number;
  event: string;
  type: string;
  stage?: string;
  label?: string;
}

const parseFrame = (frame: string, atMs: number): TimedEvent | null => {
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
    return {
      atMs,
      event,
      type: String(payload.type || event),
      stage: payload.stage ? String(payload.stage) : undefined,
      label: payload.label ? String(payload.label) : undefined,
    };
  } catch {
    return null;
  }
};

const readTimedEvents = async (response: Response, startedAt: number) => {
  if (!response.body) throw new Error('Timing canary endpoint returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: TimedEvent[] = [];
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

const email = await resolveEmail(username);
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !authData.session || !authData.user) {
  throw new Error(`Assistant timing canary login failed: ${authError?.message || 'no session'}`);
}

const { projectId, workspaceId } = await createWorkspace(authData.user);
const messageId = randomUUID();
try {
  const { error: messageError } = await supabase.from('messages').insert({
    id: messageId,
    workspace_id: workspaceId,
    sender_name: authData.user.email?.split('@')[0] || 'Timing Canary',
    sender_role: 'Kullanıcı',
    text: requestText,
    is_ai: false,
    role: 'user',
    owner_id: authData.user.id,
    attachments: [],
    reactions: [],
    grounding_urls: [],
    questions: [],
    created_at: new Date().toISOString(),
  });
  if (messageError) throw new Error(`Timing canary message could not be persisted: ${messageError.message}`);

  const startedAt = Date.now();
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
      message: requestText,
      model: 'auto',
      chatAttachments: [],
    }),
  });
  if (!response.ok) {
    throw new Error(`Timing canary endpoint ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const events = await readTimedEvents(response, startedAt);
  const durationMs = Date.now() - startedAt;
  const statuses = events.filter(item => item.type === 'status');
  const firstStatus = statuses[0];
  const firstText = events.find(item => item.type === 'text_delta');
  const preTextStatuses = statuses.filter(item => !firstText || item.atMs <= firstText.atMs);
  const uniquePreTextLabels = new Set(preTextStatuses.map(item => item.label).filter(Boolean));
  const simulatedLabels = statuses.filter(item => /talep için çalışma planı hazırlanıyor|model yanıtı üzerinde çalışıyor|yanıt üretimi devam ediyor/iu.test(item.label || ''));

  const failures: string[] = [];
  if (!firstStatus || firstStatus.atMs > 2_500) failures.push(`first_status_late:${firstStatus?.atMs ?? 'missing'}ms`);
  if (simulatedLabels.length) failures.push(`simulated_progress_labels:${simulatedLabels.map(item => item.label).join('|')}`);
  if (durationMs >= 8_000 && uniquePreTextLabels.size < 3) {
    failures.push(`insufficient_pre_text_progress:${uniquePreTextLabels.size}`);
  }
  if (durationMs >= 8_000 && preTextStatuses.every(item => item.atMs < 500)) {
    failures.push('all_progress_arrived_at_start');
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    endpoint,
    durationMs,
    firstStatusMs: firstStatus?.atMs ?? null,
    firstTextMs: firstText?.atMs ?? null,
    preTextStatusCount: preTextStatuses.length,
    uniquePreTextLabels: [...uniquePreTextLabels],
    failures,
    events,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`Assistant stream timing canary failed: ${failures.join(', ')}`);
} finally {
  await cleanupWorkspace(projectId, workspaceId);
}
