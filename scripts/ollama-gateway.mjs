import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const clean = (value) => String(value ?? '').trim();
const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
};

const host = clean(process.env.OLLAMA_GATEWAY_HOST) || '127.0.0.1';
const port = boundedInteger(process.env.OLLAMA_GATEWAY_PORT, 11435, 1, 65535);
const upstreamBaseUrl = (clean(process.env.OLLAMA_UPSTREAM_URL) || 'http://127.0.0.1:11434').replace(/\/$/, '');
const gatewayToken = clean(process.env.JETWORK_OLLAMA_GATEWAY_TOKEN);
const timeoutMs = boundedInteger(process.env.OLLAMA_GATEWAY_TIMEOUT_MS, 300_000, 10_000, 600_000);
const maxBodyBytes = boundedInteger(process.env.OLLAMA_GATEWAY_MAX_BODY_BYTES, 2_000_000, 16_384, 8_000_000);
const allowedModels = new Set(
  (clean(process.env.OLLAMA_ALLOWED_MODELS) || 'qwen3:4b-instruct')
    .split(',')
    .map(clean)
    .filter(Boolean),
);

if (gatewayToken.length < 24) {
  console.error('JETWORK_OLLAMA_GATEWAY_TOKEN must be set to a random value of at least 24 characters.');
  process.exit(1);
}

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const tokenMatches = (authorization) => {
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return false;
  const supplied = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(gatewayToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > maxBodyBytes) {
      reject(Object.assign(new Error('Request payload is too large.'), { statusCode: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();

  try {
    if (!tokenMatches(req.headers.authorization)) {
      json(res, 401, { error: 'Unauthorized.' });
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      const upstream = await fetch(`${upstreamBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
      });
      json(res, upstream.ok ? 200 : 502, {
        ok: upstream.ok,
        gateway: 'jetwork-ollama',
        upstreamStatus: upstream.status,
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/chat') {
      json(res, 404, { error: 'Only POST /api/chat is supported.' });
      return;
    }

    const rawBody = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      json(res, 400, { error: 'Request body must be valid JSON.' });
      return;
    }

    const model = clean(payload?.model);
    if (!allowedModels.has(model)) {
      json(res, 403, { error: 'Requested model is not allowed.' });
      return;
    }
    if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
      json(res, 400, { error: 'messages is required.' });
      return;
    }

    // POC safety contract: reasoning traces never leave Ollama and responses are
    // returned atomically. Streaming can be enabled later after the provider
    // adapter has a dedicated NDJSON parser and cancellation tests.
    const upstreamPayload = {
      ...payload,
      model,
      think: false,
      stream: false,
    };

    const upstream = await fetch(`${upstreamBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const responseBody = await upstream.arrayBuffer();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Content-Length': responseBody.byteLength,
      'Cache-Control': 'no-store',
      'X-JetWork-Ollama-Gateway': 'v1',
    });
    res.end(Buffer.from(responseBody));

    console.info('OLLAMA_GATEWAY_REQUEST', JSON.stringify({
      requestId,
      model,
      status: upstream.status,
      durationMs: Math.round(performance.now() - startedAt),
    }));
  } catch (error) {
    const status = Number(error?.statusCode) || (error?.name === 'TimeoutError' ? 504 : 502);
    console.error('OLLAMA_GATEWAY_ERROR', JSON.stringify({
      requestId,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      error: String(error?.message || error).slice(0, 500),
    }));
    if (!res.headersSent) json(res, status, { error: status === 504 ? 'Ollama request timed out.' : 'Ollama gateway request failed.' });
    else res.end();
  }
});

server.listen(port, host, () => {
  console.info(`JetWork Ollama gateway listening on http://${host}:${port}`);
  console.info(`Allowed models: ${[...allowedModels].join(', ')}`);
  console.info(`Upstream: ${upstreamBaseUrl}`);
});
