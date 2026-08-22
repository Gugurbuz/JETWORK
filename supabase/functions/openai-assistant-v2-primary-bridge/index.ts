import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.99.3';
import { GoogleGenAI } from 'npm:@google/genai@1.52.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'x-jetwork-auto-route',
};

const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-JetWork-Primary-Agent-Bridge': 'v2-auto-routing',
};

const AUTO_MODEL = 'auto';
const LITE_MODEL = 'gemini-3.5-flash-lite';
const FLASH_MODEL = 'gemini-3.5-flash';
const PRO_MODEL = 'gemini-3.1-pro-preview';
const ROUTER_VERSION = 'primary-bridge-auto-v1';
const MAX_CONTEXT_MESSAGES = 6;
const MAX_CONTEXT_CHARS = 3_000;

type RoutedModel = typeof LITE_MODEL | typeof FLASH_MODEL | typeof PRO_MODEL;

type RouterUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type RouteDecision = {
  routedModel: RoutedModel;
  decision: 'USE_LITE' | 'USE_FLASH' | 'USE_PRO';
  usage: RouterUsage;
};

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const cleanString = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength);

const parseBody = (body: ArrayBuffer): Record<string, any> | null => {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
};

const responseText = (response: any): string => {
  if (typeof response?.text === 'string') return response.text.trim();
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part: any) => !part?.thought && typeof part?.text === 'string')
    .map((part: any) => String(part.text))
    .join('')
    .trim();
};

const routerUsage = (response: any): RouterUsage => {
  const metadata = response?.usageMetadata || {};
  const inputTokens = Math.max(0, Number(metadata.promptTokenCount || 0));
  const outputTokens = Math.max(0, Number(metadata.candidatesTokenCount || 0));
  const reasoningTokens = Math.max(0, Number(metadata.thoughtsTokenCount || 0));
  const totalTokens = Math.max(0, Number(metadata.totalTokenCount || inputTokens + outputTokens + reasoningTokens));
  const estimatedCostUsd = ((inputTokens * 0.30) + ((outputTokens + reasoningTokens) * 2.50)) / 1_000_000;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens, estimatedCostUsd };
};

const loadCompactContext = async (input: {
  supabaseUrl: string;
  anonKey: string;
  authorization: string;
  workspaceId: string;
  messageId: string;
}) => {
  if (!input.workspaceId) return '';
  const client = createClient(input.supabaseUrl, input.anonKey, {
    global: { headers: { Authorization: input.authorization } },
    auth: { persistSession: false },
  });
  let query = client
    .from('messages')
    .select('role,text,created_at')
    .eq('workspace_id', input.workspaceId)
    .in('role', ['user', 'model'])
    .order('created_at', { ascending: false })
    .limit(MAX_CONTEXT_MESSAGES);
  if (input.messageId) query = query.neq('id', input.messageId);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return '';

  let used = 0;
  const lines: string[] = [];
  for (const row of [...data].reverse()) {
    const role = row.role === 'user' ? 'user' : 'assistant';
    const text = cleanString(String(row.text || '').replace(/\s+/g, ' '), 700);
    if (!text) continue;
    const line = `${role}: ${text}`;
    if (used + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
};

const routeAuto = async (input: {
  apiKey: string;
  message: string;
  context: string;
  attachments: any[];
}): Promise<RouteDecision> => {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const prompt = [
    `Current user request:\n${cleanString(input.message, 3_000)}`,
    input.context ? `Recent conversation context (continuity only, not evidence):\n${input.context}` : '',
    input.attachments.length
      ? `Attachments: ${input.attachments.slice(0, 3).map(item => `${cleanString(item?.name, 120)} (${cleanString(item?.mimeType, 80)})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const response = await ai.models.generateContent({
    model: LITE_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction: [
        'You are the JetWork model routing gate. Do not answer the user.',
        'Output exactly one token: USE_LITE, USE_FLASH, or USE_PRO.',
        'Choose USE_LITE for routine conversation, concise Q&A, straightforward enterprise knowledge lookup, summarization, and single-step tasks.',
        'Choose USE_FLASH when the request or conversation continuity materially needs multi-step reasoning, technical synthesis, comparison, debugging, or several tool/evidence interactions.',
        'Choose USE_PRO only for unusually difficult, high-stakes multi-constraint reasoning where Flash is materially insufficient.',
        'The availability or absence of enterprise evidence is not itself a reason to escalate. RAG/tool access remains available after routing.',
        'Judge the meaning of the request and conversation; do not route from isolated keywords.',
      ].join(' '),
      temperature: 0,
      maxOutputTokens: 16,
    },
  } as any);

  const raw = responseText(response).toUpperCase();
  const decision: RouteDecision['decision'] = raw === 'USE_LITE'
    ? 'USE_LITE'
    : raw === 'USE_PRO'
      ? 'USE_PRO'
      : 'USE_FLASH';
  const routedModel: RoutedModel = decision === 'USE_LITE'
    ? LITE_MODEL
    : decision === 'USE_PRO'
      ? PRO_MODEL
      : FLASH_MODEL;
  return { routedModel, decision, usage: routerUsage(response) };
};

const numericUsage = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount = Number(raw);
    if (Number.isFinite(amount)) result[key] = amount;
  }
  return result;
};

const addUsage = (...values: Array<Record<string, number> | undefined>) => {
  const merged: Record<string, number> = {};
  for (const value of values) {
    for (const [key, amount] of Object.entries(value || {})) {
      if (Number.isFinite(amount)) merged[key] = (merged[key] || 0) + amount;
    }
  }
  return merged;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const persistRouteTelemetry = async (input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  workspaceId: string;
  messageId: string;
  route: RouteDecision;
}) => {
  if (!input.workspaceId || !input.messageId) return;
  const admin = createClient(input.supabaseUrl, input.serviceRoleKey, { auth: { persistSession: false } });
  let turn: any = null;
  for (const delayMs of [0, 100, 300, 800, 1_500]) {
    if (delayMs) await sleep(delayMs);
    const { data } = await admin
      .from('assistant_turns')
      .select('id,usage')
      .eq('workspace_id', input.workspaceId)
      .eq('message_id', input.messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      turn = data;
      break;
    }
  }
  if (!turn?.id) {
    console.warn('PRIMARY_BRIDGE_AUTO_TELEMETRY_TURN_NOT_FOUND', input.messageId);
    return;
  }

  const routeUsage = {
    input_tokens: input.route.usage.inputTokens,
    output_tokens: input.route.usage.outputTokens,
    reasoning_tokens: input.route.usage.reasoningTokens,
    total_tokens: input.route.usage.totalTokens,
    estimated_cost_usd: input.route.usage.estimatedCostUsd,
    primary_llm_router_calls: 1,
    auto_model_cascade_started: 1,
    auto_model_router_calls: 1,
    ...(input.route.routedModel === LITE_MODEL ? { auto_model_routed_lite: 1 } : {}),
    ...(input.route.routedModel === FLASH_MODEL ? { auto_model_routed_flash: 1 } : {}),
    ...(input.route.routedModel === PRO_MODEL ? { auto_model_routed_pro: 1 } : {}),
  };
  const usage = addUsage(numericUsage(turn.usage), routeUsage);
  const { error } = await admin.from('assistant_turns').update({ usage }).eq('id', turn.id);
  if (error) console.warn('PRIMARY_BRIDGE_AUTO_TELEMETRY_UPDATE_FAILED', error.message);
  else console.info('PRIMARY_BRIDGE_AUTO_TELEMETRY_PERSISTED', JSON.stringify({
    messageId: input.messageId,
    turnId: turn.id,
    routedModel: input.route.routedModel,
    decision: input.route.decision,
  }));
};

const proxyStream = (
  upstream: Response,
  route: RouteDecision | null,
  persist: () => Promise<void>,
) => {
  if (!upstream.body) return upstream;
  const headers = new Headers(streamHeaders);
  if (route) headers.set('x-jetwork-auto-route', route.routedModel);
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && !closed) {
            try { controller.enqueue(value); } catch { closed = true; }
          }
        }
      } catch (error) {
        if (!closed) {
          try { controller.error(error); } catch { /* client disconnected */ }
        }
      } finally {
        try { if (!closed) controller.close(); } catch { /* client disconnected */ }
        const work = persist().catch(error => console.warn('PRIMARY_BRIDGE_AUTO_TELEMETRY_FAILED', String(error).slice(0, 500)));
        const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
        if (runtime?.waitUntil) runtime.waitUntil(work);
        else void work;
      }
    },
  });
  return new Response(stream, { status: upstream.status, headers });
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405);

  const authorization = req.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!authorization || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: 'Authentication is required.' }, 401);
  }

  let rawBody: ArrayBuffer;
  try {
    rawBody = await req.arrayBuffer();
  } catch {
    return jsonResponse({ error: 'Request body could not be read.' }, 400);
  }
  const body = parseBody(rawBody);
  if (!body) return jsonResponse({ error: 'Request body is invalid.' }, 400);

  const requestedModel = cleanString(body.model || AUTO_MODEL, 80);
  const workspaceId = cleanString(body.workspaceId, 200);
  const messageId = cleanString(body.messageId, 240);
  let forwardedBody = body;
  let route: RouteDecision | null = null;

  if (requestedModel === AUTO_MODEL) {
    if (!geminiApiKey) {
      return jsonResponse({ error: 'GEMINI_API_KEY is required for Auto routing.', code: 'AUTO_ROUTER_UNAVAILABLE' }, 503);
    }
    const context = await loadCompactContext({ supabaseUrl, anonKey, authorization, workspaceId, messageId });
    try {
      route = await routeAuto({
        apiKey: geminiApiKey,
        message: cleanString(body.message, 32_000),
        context,
        attachments: Array.isArray(body.chatAttachments) ? body.chatAttachments.slice(0, 3) : [],
      });
    } catch (error) {
      console.warn('PRIMARY_BRIDGE_AUTO_ROUTER_FAILED_KEEP_FLASH', String(error).slice(0, 500));
      route = {
        routedModel: FLASH_MODEL,
        decision: 'USE_FLASH',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      };
    }
    forwardedBody = { ...body, model: route.routedModel };
    console.info('PRIMARY_BRIDGE_AUTO_ROUTE', JSON.stringify({
      version: ROUTER_VERSION,
      messageId,
      workspaceId,
      routedModel: route.routedModel,
      decision: route.decision,
    }));
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': `jetwork-${ROUTER_VERSION}`,
      },
      body: JSON.stringify(forwardedBody),
    });
  } catch (error) {
    console.error('Primary-agent bridge could not reach openai-assistant:', error);
    return jsonResponse({
      error: 'Asistan servisine bağlanılamadı. Lütfen tekrar deneyin.',
      code: 'PRIMARY_AGENT_UNREACHABLE',
    }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const responseBody = await upstream.arrayBuffer().catch(() => new ArrayBuffer(0));
    return new Response(responseBody, {
      status: upstream.status || 502,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'X-JetWork-Primary-Agent-Bridge': 'v2-auto-routing',
      },
    });
  }

  return proxyStream(
    upstream,
    route,
    route && serviceRoleKey
      ? () => persistRouteTelemetry({ supabaseUrl, serviceRoleKey, workspaceId, messageId, route: route as RouteDecision })
      : async () => {},
  );
});
