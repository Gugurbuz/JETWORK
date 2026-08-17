import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_SIZE = 1_000
const MAX_ROWS = 50_000
const ALLOWED_PERIODS = new Set([7, 30, 90])
const GOOGLE_SEARCH_PRICE_PER_1K_USD = Number(Deno.env.get('GOOGLE_SEARCH_PRICE_PER_1K_USD') || 14)
const GOOGLE_SEARCH_FREE_REQUESTS_MONTHLY = Number(Deno.env.get('GOOGLE_SEARCH_FREE_REQUESTS_MONTHLY') || 5_000)

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const asNumber = (value: unknown) => {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits))

const percentile = (values: number[], percentileValue: number) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1))
  return sorted[index]
}

const normalizePeriod = (value: unknown) => {
  const parsed = Math.trunc(asNumber(value))
  return ALLOWED_PERIODS.has(parsed) ? parsed : 30
}

const utcDateKey = (value: Date | string) => new Date(value).toISOString().slice(0, 10)

const isManagerRole = (role: unknown) => {
  const normalized = String(role || '').trim().toLocaleLowerCase('tr-TR')
  return normalized === 'yönetici' || normalized === 'yonetici' || normalized === 'admin' || normalized === 'administrator'
}

type TurnRow = {
  created_at: string
  status: string | null
  response_model: string | null
  usage: Record<string, unknown> | null
  owner_id: string | null
}

type OwnerAggregate = {
  ownerId: string
  turns: number
  completed: number
  costUsd: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)
  if (!serviceRoleKey) return jsonResponse({ error: 'Cost metrics environment is incomplete.' }, 500)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError || !authData.user || authData.user.is_anonymous) {
    return jsonResponse({ error: 'A permanent authenticated user is required.' }, 401)
  }

  const userId = authData.user.id
  const { data: profile } = await admin
    .from('users')
    .select('role,name,surname')
    .eq('uid', userId)
    .maybeSingle()

  const manager = isManagerRole(profile?.role)
  const body = await req.json().catch(() => ({}))
  const periodDays = normalizePeriod(body?.periodDays)
  const now = new Date()
  const from = new Date(now.getTime() - (periodDays - 1) * 86_400_000)
  from.setUTCHours(0, 0, 0, 0)

  let countQuery = admin
    .from('assistant_turns')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', from.toISOString())
  if (!manager) countQuery = countQuery.eq('owner_id', userId)
  const { count: periodRowCount, error: countError } = await countQuery
  if (countError) return jsonResponse({ error: countError.message }, 500)

  const rows: TurnRow[] = []
  const targetRows = Math.min(periodRowCount || 0, MAX_ROWS)
  for (let offset = 0; offset < targetRows; offset += PAGE_SIZE) {
    const end = Math.min(offset + PAGE_SIZE - 1, targetRows - 1)
    let query = admin
      .from('assistant_turns')
      .select('created_at,status,response_model,usage,owner_id')
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: false })
      .range(offset, end)
    if (!manager) query = query.eq('owner_id', userId)
    const { data, error } = await query
    if (error) return jsonResponse({ error: error.message }, 500)
    rows.push(...((data || []) as TurnRow[]))
    if ((data || []).length < end - offset + 1) break
  }

  const completedRows = rows.filter(row => row.status === 'completed')
  const costs = completedRows.map(row => asNumber(row.usage?.estimated_cost_usd)).filter(value => value >= 0)
  const trackedCostUsd = costs.reduce((sum, value) => sum + value, 0)
  const sumUsage = (key: string) => completedRows.reduce((sum, row) => sum + asNumber(row.usage?.[key]), 0)
  const providerCallsFor = (row: TurnRow) => asNumber(row.usage?.primary_llm_agent_calls) + asNumber(row.usage?.primary_llm_final_calls)
  const webCallsFor = (row: TurnRow) => asNumber(row.usage?.gemini_native_web_requested)
  const multiCallRows = completedRows.filter(row => providerCallsFor(row) >= 3)
  const proRows = completedRows.filter(row => String(row.response_model || '').toLowerCase().includes('pro'))
  const webRows = completedRows.filter(row => webCallsFor(row) > 0)
  const retryRows = completedRows.filter(row => asNumber(row.usage?.gemini_empty_final_retry) > 0)
  const owners = new Set(rows.map(row => row.owner_id).filter(Boolean))

  const dailyMap = new Map<string, { date: string; turns: number; completed: number; costUsd: number; proTurns: number; webTurns: number }>()
  for (let day = 0; day < periodDays; day += 1) {
    const date = new Date(from.getTime() + day * 86_400_000)
    const key = utcDateKey(date)
    dailyMap.set(key, { date: key, turns: 0, completed: 0, costUsd: 0, proTurns: 0, webTurns: 0 })
  }
  for (const row of rows) {
    const key = utcDateKey(row.created_at)
    const bucket = dailyMap.get(key)
    if (!bucket) continue
    bucket.turns += 1
    if (row.status === 'completed') {
      bucket.completed += 1
      bucket.costUsd += asNumber(row.usage?.estimated_cost_usd)
      if (String(row.response_model || '').toLowerCase().includes('pro')) bucket.proTurns += 1
      if (webCallsFor(row) > 0) bucket.webTurns += 1
    }
  }
  const daily = [...dailyMap.values()].map(item => ({ ...item, costUsd: round(item.costUsd) }))

  const modelMap = new Map<string, { model: string; turns: number; costUsd: number; inputTokens: number; outputTokens: number; reasoningTokens: number; providerCalls: number }>()
  for (const row of completedRows) {
    const model = row.response_model || '(none)'
    const aggregate = modelMap.get(model) || { model, turns: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, providerCalls: 0 }
    aggregate.turns += 1
    aggregate.costUsd += asNumber(row.usage?.estimated_cost_usd)
    aggregate.inputTokens += asNumber(row.usage?.input_tokens)
    aggregate.outputTokens += asNumber(row.usage?.output_tokens)
    aggregate.reasoningTokens += asNumber(row.usage?.reasoning_tokens)
    aggregate.providerCalls += providerCallsFor(row)
    modelMap.set(model, aggregate)
  }
  const models = [...modelMap.values()]
    .map(item => ({
      ...item,
      costUsd: round(item.costUsd),
      avgCostUsd: round(item.costUsd / Math.max(1, item.turns)),
      costShare: trackedCostUsd > 0 ? round(item.costUsd / trackedCostUsd, 4) : 0,
      avgProviderCalls: round(item.providerCalls / Math.max(1, item.turns), 2),
    }))
    .sort((a, b) => b.costUsd - a.costUsd)

  const ownerMap = new Map<string, OwnerAggregate>()
  for (const row of rows) {
    if (!row.owner_id) continue
    const aggregate = ownerMap.get(row.owner_id) || { ownerId: row.owner_id, turns: 0, completed: 0, costUsd: 0 }
    aggregate.turns += 1
    if (row.status === 'completed') {
      aggregate.completed += 1
      aggregate.costUsd += asNumber(row.usage?.estimated_cost_usd)
    }
    ownerMap.set(row.owner_id, aggregate)
  }

  let topUsers: Array<OwnerAggregate & { displayName: string }> = []
  if (manager && ownerMap.size) {
    const top = [...ownerMap.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, 10)
    const ownerIds = top.map(item => item.ownerId)
    const { data: userRows } = await admin.from('users').select('uid,name,surname').in('uid', ownerIds)
    const names = new Map((userRows || []).map(row => [String(row.uid), `${String(row.name || '').trim()} ${String(row.surname || '').trim()}`.trim() || 'Kullanıcı']))
    topUsers = top.map(item => ({ ...item, costUsd: round(item.costUsd), displayName: names.get(item.ownerId) || 'Kullanıcı' }))
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  let monthQuery = admin
    .from('assistant_turns')
    .select('usage')
    .gte('created_at', monthStart.toISOString())
    .eq('status', 'completed')
    .limit(MAX_ROWS)
  if (!manager) monthQuery = monthQuery.eq('owner_id', userId)
  const { data: monthRows } = await monthQuery
  const monthlyWebProviderCalls = (monthRows || []).reduce((sum, row) => sum + asNumber((row.usage as Record<string, unknown> | null)?.gemini_native_web_requested), 0)
  const billableSearchLowerBound = Math.max(0, monthlyWebProviderCalls - GOOGLE_SEARCH_FREE_REQUESTS_MONTHLY)
  const estimatedSearchCostLowerBoundUsd = billableSearchLowerBound * GOOGLE_SEARCH_PRICE_PER_1K_USD / 1_000

  const avgCostUsd = trackedCostUsd / Math.max(1, completedRows.length)
  const p50CostUsd = percentile(costs, 0.50)
  const p95CostUsd = percentile(costs, 0.95)
  const p99CostUsd = percentile(costs, 0.99)
  const proShare = proRows.length / Math.max(1, completedRows.length)
  const multiCallShare = multiCallRows.length / Math.max(1, completedRows.length)

  const targets = {
    avgCost: { label: 'Ortalama turn', value: round(avgCostUsd), target: 0.01, pass: avgCostUsd <= 0.01 },
    p95Cost: { label: 'P95 turn', value: round(p95CostUsd), target: 0.04, pass: p95CostUsd <= 0.04 },
    proShare: { label: 'Pro kullanım oranı', value: round(proShare, 4), target: 0.15, pass: proShare <= 0.15 },
    multiCallShare: { label: '3+ LLM çağrılı turn', value: round(multiCallShare, 4), target: 0.05, pass: multiCallShare <= 0.05 },
  }

  return jsonResponse({
    generatedAt: now.toISOString(),
    scope: manager ? 'global' : 'user',
    viewerRole: profile?.role || null,
    periodDays,
    sampled: (periodRowCount || 0) > MAX_ROWS,
    sampledRows: rows.length,
    periodRowCount: periodRowCount || 0,
    summary: {
      turnsTotal: rows.length,
      completed: completedRows.length,
      nonCompleted: rows.length - completedRows.length,
      activeOwners: owners.size,
      trackedTokenCostUsd: round(trackedCostUsd),
      avgCostUsd: round(avgCostUsd),
      p50CostUsd: round(p50CostUsd),
      p95CostUsd: round(p95CostUsd),
      p99CostUsd: round(p99CostUsd),
      avgInputTokens: Math.round(sumUsage('input_tokens') / Math.max(1, completedRows.length)),
      avgOutputTokens: Math.round(sumUsage('output_tokens') / Math.max(1, completedRows.length)),
      avgReasoningTokens: Math.round(sumUsage('reasoning_tokens') / Math.max(1, completedRows.length)),
      avgProviderCalls: round(completedRows.reduce((sum, row) => sum + providerCallsFor(row), 0) / Math.max(1, completedRows.length), 2),
      proTurns: proRows.length,
      proShare: round(proShare, 4),
      webTurns: webRows.length,
      webTurnShare: round(webRows.length / Math.max(1, completedRows.length), 4),
      retryTurns: retryRows.length,
      multiCall3PlusTurns: multiCallRows.length,
      multiCall3PlusShare: round(multiCallShare, 4),
      multiCall3PlusCostUsd: round(multiCallRows.reduce((sum, row) => sum + asNumber(row.usage?.estimated_cost_usd), 0)),
    },
    search: {
      month: monthStart.toISOString().slice(0, 7),
      providerWebRequestLowerBound: monthlyWebProviderCalls,
      monthlyFreeRequestsAssumption: GOOGLE_SEARCH_FREE_REQUESTS_MONTHLY,
      pricePer1kUsdAssumption: GOOGLE_SEARCH_PRICE_PER_1K_USD,
      billableRequestLowerBound: billableSearchLowerBound,
      estimatedCostLowerBoundUsd: round(estimatedSearchCostLowerBoundUsd),
      note: 'Provider web marker sayısı gerçek Google Search query sayısından düşük olabilir; bu nedenle arama maliyeti alt sınır tahminidir.',
    },
    targets,
    daily,
    models,
    topUsers,
  })
})
