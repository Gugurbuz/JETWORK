import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.99.3';

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Only POST is supported.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Runner configuration missing.' }, 500);

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const requestId = String(body?.requestId || '').trim();
  const suppliedSecret = String(body?.secret || '').trim();
  if (!requestId || !suppliedSecret) return json({ error: 'requestId and secret are required.' }, 400);

  const [{ data: config }, { data: requestRow }] = await Promise.all([
    service.from('ai_quality_internal_config').select('secret').eq('key', 'runner_webhook_secret').maybeSingle(),
    service.from('ai_quality_run_requests').select('*').eq('id', requestId).maybeSingle(),
  ]);
  if (!config?.secret || suppliedSecret !== config.secret) return json({ error: 'Unauthorized.' }, 401);
  if (!requestRow) return json({ error: 'Run request not found.' }, 404);
  if (!['queued', 'running'].includes(requestRow.status)) return json({ ok: true, status: requestRow.status });

  await service.from('ai_quality_run_requests').update({ status: 'running', started_at: new Date().toISOString(), error_message: null }).eq('id', requestId);

  const email = `quality-${requestId}@jetwork.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  let ephemeralUserId = '';
  try {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { purpose: 'ai_quality_internal_runner' },
    });
    if (createError || !created.user) throw createError || new Error('Quality test user could not be created.');
    ephemeralUserId = created.user.id;

    await service.from('users').upsert({
      uid: ephemeralUserId,
      email,
      name: 'Quality',
      surname: 'Runner',
      role: 'Quality Runner',
      onboarding_completed: true,
      username: `quality-${requestId.slice(0, 8)}`,
      color: '#888888',
    }, { onConflict: 'uid' });

    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: sessionData, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !sessionData.session) throw signInError || new Error('Quality test session could not be created.');

    const response = await fetch(`${supabaseUrl}/functions/v1/ai-quality-runner`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': 'jetwork-ai-quality-internal/1.0',
      },
      body: JSON.stringify({
        suiteSlug: requestRow.suite_slug,
        endpoint: requestRow.endpoint || 'openai-assistant-v2',
        trigger: requestRow.trigger || 'assistant',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error || `Quality runner HTTP ${response.status}`);

    await service.from('ai_quality_run_requests').update({
      status: 'completed',
      response: payload,
      completed_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', requestId);

    return json({ ok: true, requestId, runId: payload?.run?.id, status: payload?.run?.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service.from('ai_quality_run_requests').update({
      status: 'failed',
      error_message: message.slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).eq('id', requestId);
    console.error('Internal quality runner failed:', error);
    return json({ error: message }, 500);
  } finally {
    if (ephemeralUserId) {
      await service.from('users').delete().eq('uid', ephemeralUserId).catch(() => undefined);
      await service.auth.admin.deleteUser(ephemeralUserId).catch(() => undefined);
    }
  }
});
