import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { ASSISTANT_KNOWLEDGE_TOOLS, executeAssistantTool } from './assistantToolsEvidenceBoundary.ts'
import { requestGeminiResponse, DEFAULT_GEMINI_MODEL } from './modelProvidersEvidenceBoundary.ts'

const WORKSPACE_ID = '5536f5b2-2344-4a7e-8c8b-adb1fb4673dc'

const addUsage = (left: Record<string, unknown> = {}, right: Record<string, unknown> = {}) => {
  const merged: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (typeof value === 'number') merged[key] = Number(merged[key] || 0) + value
  }
  return merged
}

const outputText = (response: any) => (response.output || [])
  .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
  .filter((part: any) => part?.type === 'output_text')
  .map((part: any) => String(part.text || ''))
  .join('')

async function authenticatedClient() {
  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, service, { auth: { persistSession: false } })

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .select('owner_id')
    .eq('id', WORKSPACE_ID)
    .maybeSingle()
  if (workspaceError || !workspace?.owner_id) throw workspaceError || new Error('Test workspace owner unavailable')

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(String(workspace.owner_id))
  if (userError || !userData.user?.email) throw userError || new Error('Test workspace owner email unavailable')

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: userData.user.email })
  if (linkError) throw linkError

  const auth = createClient(url, anon, { auth: { persistSession: false } })
  const { data: sessionData, error: verifyError } = await auth.auth.verifyOtp({
    token_hash: (link as any).properties.hashed_token,
    type: 'magiclink',
  })
  if (verifyError || !sessionData.session) throw verifyError || new Error('Test session unavailable')

  return {
    admin,
    auth,
    client: createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${sessionData.session.access_token}` } },
      auth: { persistSession: false },
    }),
  }
}

async function runTurn(client: any, apiKey: string, prompt: string, query: string, history: any[] = []) {
  const items: any[] = [...history, { role: 'user', content: query }]
  const calls: any[] = []
  const sources: any[] = []
  let usage: Record<string, unknown> = {}
  const started = performance.now()

  for (let round = 0; round <= 4; round += 1) {
    let streamed = ''
    const response: any = await requestGeminiResponse({
      apiKey,
      model: DEFAULT_GEMINI_MODEL,
      instructions: round === 4
        ? `${prompt}\n\nAraç araştırması tamamlandı. Yeni araç çağırmadan, eldeki kanıta göre nihai yanıt üret.`
        : prompt,
      items,
      tools: ASSISTANT_KNOWLEDGE_TOOLS as any,
      allowTools: round < 4,
      maxOutputTokens: 8000,
      onText: (delta: string) => { streamed += delta },
    })
    usage = addUsage(usage, response.usage)
    const toolCalls = (response.output || []).filter((item: any) => item.type === 'function_call')
    if (!toolCalls.length) {
      return {
        query,
        text: streamed || outputText(response),
        model: response.model || DEFAULT_GEMINI_MODEL,
        calls,
        sources,
        usage,
        durationMs: Math.round(performance.now() - started),
      }
    }

    items.push(...response.output)
    for (const call of toolCalls) {
      const args = JSON.parse(call.arguments || '{}')
      const toolStarted = performance.now()
      const result = await executeAssistantTool(client, WORKSPACE_ID, call.name, args)
      calls.push({
        name: call.name,
        args,
        summary: result.summary,
        durationMs: Math.round(performance.now() - toolStarted),
      })
      for (const source of result.sources || []) {
        const key = source.canonicalKey || `${source.sourceId}|${source.sourceName}`
        if (!sources.some((existing: any) => (existing.canonicalKey || `${existing.sourceId}|${existing.sourceName}`) === key)) sources.push(source)
      }
      items.push({ type: 'function_call_output', call_id: call.call_id, output: result.output })
    }
  }
  throw new Error('Tool rounds exhausted')
}

async function runConversation(client: any, apiKey: string, prompt: string, turns: string[]) {
  const history: any[] = []
  const results: any[] = []
  for (const query of turns) {
    const result = await runTurn(client, apiKey, prompt, query, history)
    results.push(result)
    history.push({ role: 'user', content: query }, { role: 'assistant', content: result.text })
  }
  return results
}

Deno.serve(async (req: Request) => {
  let auth: any
  try {
    const body = await req.json().catch(() => ({}))
    const setup = await authenticatedClient()
    auth = setup.auth
    const { data: promptRows, error: promptError } = await setup.admin
      .from('assistant_prompt_versions')
      .select('prompt_text,version')
      .eq('is_active', true)
      .is('workspace_id', null)
      .order('version', { ascending: false })
      .limit(1)
    if (promptError || !promptRows?.[0]) throw promptError || new Error('Active prompt missing')
    const apiKey = Deno.env.get('GEMINI_API_KEY')!

    if (Array.isArray(body.cases)) {
      const cases = []
      for (const testCase of body.cases.slice(0, 5)) {
        const turns = Array.isArray(testCase?.turns)
          ? testCase.turns.map(String)
          : [String(testCase?.query || '')]
        cases.push({ id: String(testCase?.id || ''), turns: await runConversation(setup.client, apiKey, promptRows[0].prompt_text, turns) })
      }
      return new Response(JSON.stringify({ ok: true, promptVersion: promptRows[0].version, cases }), { headers: { 'content-type': 'application/json' } })
    }

    const turns = Array.isArray(body.turns) ? body.turns.map(String) : [String(body.query || '')]
    const results = await runConversation(setup.client, apiKey, promptRows[0].prompt_text, turns)
    return new Response(JSON.stringify({ ok: true, promptVersion: promptRows[0].version, results, result: results.at(-1) }), { headers: { 'content-type': 'application/json' } })
  } catch (error) {
    const detail = error instanceof Error ? error.message : JSON.stringify(error)
    return new Response(JSON.stringify({ ok: false, error: detail }), { status: 500, headers: { 'content-type': 'application/json' } })
  } finally {
    try { await auth?.auth.signOut() } catch {}
  }
})
