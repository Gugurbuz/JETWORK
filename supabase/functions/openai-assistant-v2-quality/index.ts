import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-JetWork-Quality-Recovery': 'v1.1',
};
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const ENTERPRISE_EXACT = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/iu;
const ENTERPRISE_DOMAIN = /\b(?:SAP|CRM|C4C|IS[- ]?U|FICA|ABAP|JIRA|ENERJISA)\b/iu;
const COST_EVIDENCE = /\bcost\b/iu;
const COST_INTENT = /(?:hata|mesaj|uyarı|uyari|alınacak|alinacak|alınan|alinan|alırken|alirken|neler|nelerdir|liste)/iu;
const TECHNICAL_FOLLOW_UP = /^(?:teknik(?: olarak)? aç(?:ıkla|ar mısın)|teknik(?: olarak)? detaylandır|detaylandır|biraz daha detay|bunu aç|açıkla|nasıl yani|peki(?: bunun)?|hangi koşulda|koşulu ne|kodu ne|tam kod(?:u)? ver)\b/iu;

const shouldPreferFlash = (message: string) => (
  ENTERPRISE_EXACT.test(message)
  || ENTERPRISE_DOMAIN.test(message)
  || TECHNICAL_FOLLOW_UP.test(message)
  || (COST_EVIDENCE.test(message) && COST_INTENT.test(message))
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405);

  const authorization = req.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401);

  let body: ArrayBuffer;
  try { body = await req.arrayBuffer(); } catch { return jsonResponse({ error: 'Request body could not be read.' }, 400); }

  let upstreamBody: BodyInit = body;
  let qualityModelOverride = false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body));
    const message = String(parsed?.message || '').trim();
    if (String(parsed?.model || 'auto').trim() === 'auto' && shouldPreferFlash(message)) {
      parsed.model = 'gemini-3.5-flash';
      upstreamBody = JSON.stringify(parsed);
      qualityModelOverride = true;
      console.info('ASSISTANT_QUALITY_MODEL_FLOOR', JSON.stringify({
        messageId: String(parsed?.messageId || ''),
        routedModel: parsed.model,
        reason: 'enterprise_evidence_quality_floor',
      }));
    }
  } catch {
    // The semantic gateway validates malformed payloads.
  }

  const upstreamPromise = fetch(`${supabaseUrl}/functions/v1/openai-assistant-semantic-v2`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: anonKey,
      'Content-Type': req.headers.get('Content-Type') || 'application/json',
      'x-client-info': qualityModelOverride ? 'jetwork-quality-recovery/v1.1-flash' : 'jetwork-quality-recovery/v1.1',
    },
    body: upstreamBody,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: status\ndata: {"type":"status","stage":"connecting","label":"Talep işleme alındı"}\n\n'));
      void (async () => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        try {
          const upstream = await upstreamPromise;
          if (!upstream.ok) {
            const text = await upstream.text().catch(() => `Asistan servisi ${upstream.status} hatası döndürdü.`);
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', message: text })}\n\n`));
            return;
          }
          if (!upstream.body) {
            controller.enqueue(encoder.encode('event: error\ndata: {"type":"error","message":"Asistan servisi boş yanıt döndürdü."}\n\n'));
            return;
          }
          reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Asistan akışı tamamlanamadı.' })}\n\n`));
        } finally {
          try { reader?.releaseLock(); } catch { /* noop */ }
          controller.close();
        }
      })();
    },
    cancel(reason) {
      void upstreamPromise.then(response => response.body?.cancel(reason)).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      ...streamHeaders,
      'X-JetWork-Quality-Model-Override': qualityModelOverride ? '1' : '0',
    },
  });
});
