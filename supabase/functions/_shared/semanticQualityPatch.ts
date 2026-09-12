const SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i
const CORE_PATH = '/functions/v1/openai-assistant-core-v2'
const EXACT_MESSAGE_PATTERN = /\b(?:Z[A-Z0-9_]+)-\d{3,4}\b/u

const normalize = (value: string) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const userRequestFrom = (message: string) => {
  const marker = 'Kullanıcının gerçek talebi:'
  const index = message.lastIndexOf(marker)
  if (index >= 0) return message.slice(index + marker.length).trim()
  return message.replace(SEMANTIC_PLAN_PATTERN, '').trim()
}

const isCostMessageInventoryRequest = (message: string) => {
  const text = normalize(userRequestFrom(message))
  return /\bcost\b/u.test(text)
    && /\b(?:hata|hatalar|mesaj|mesajlar)\b/u.test(text)
    && /\b(?:neler|hangileri|liste|listele|listesi|alinacak|alınacak|tum|tüm|hepsi)\b/u.test(text)
}

const exactMessageCodeFrom = (message: string) => {
  const request = userRequestFrom(message).toLocaleUpperCase('en-US')
  return request.match(EXACT_MESSAGE_PATTERN)?.[0] || null
}

const unique = (values: unknown[], limit = 12) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit)

const patchPlan = (rawPlan: Record<string, any>, message: string) => {
  const request = userRequestFrom(message)
  const costInventory = isCostMessageInventoryRequest(message)
  const exactCode = costInventory ? null : exactMessageCodeFrom(message)
  if (!costInventory && !exactCode) return { plan: rawPlan, changed: false, reason: 'passthrough' }

  const conversationState = rawPlan.conversationState && typeof rawPlan.conversationState === 'object'
    ? { ...rawPlan.conversationState }
    : {}

  if (costInventory) {
    const prefix = 'message:zcrm_cost-'
    const plan = {
      ...rawPlan,
      intent: 'analysis',
      complexity: 'low',
      executionMode: 'knowledge',
      promptProfile: 'knowledge',
      knowledgeRequired: true,
      enterpriseGroundingRequired: false,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      evidenceQueries: [],
      enumerationTarget: {
        tool: 'list_knowledge_catalog',
        objectType: 'message',
        prefix,
        cursor: null,
      },
      goal: [
        request,
        `[JETWORK_INVENTORY_TARGET] tool=list_knowledge_catalog; objectType=message; prefix=${prefix}.`,
        'Yalnız bu canonical prefix altındaki published mesajları deterministik olarak listele. Prefix dışına genişleme.',
      ].join('\n'),
      conversationState: {
        ...conversationState,
        continuation: false,
        topic: 'ZCRM_COST mesaj envanteri',
        userMove: 'new_request',
        operationMove: 'none',
        resolvedRequest: request,
        activeEntities: ['ZCRM_COST'],
        requestedEvidence: ['message_text'],
        openQuestions: [],
      },
    }
    return { plan, changed: true, reason: 'cost-message-inventory' }
  }

  const code = String(exactCode)
  const existingEvidence = Array.isArray(rawPlan.evidenceQueries) ? rawPlan.evidenceQueries : []
  const plan = {
    ...rawPlan,
    intent: rawPlan.intent === 'sap_diagnosis' ? rawPlan.intent : 'analysis',
    complexity: rawPlan.complexity === 'high' ? 'high' : 'medium',
    executionMode: 'knowledge',
    promptProfile: 'knowledge',
    knowledgeRequired: true,
    enterpriseGroundingRequired: true,
    webMode: 'none',
    verificationRequired: false,
    evidenceQueries: unique([code, ...existingEvidence], 4),
    enumerationTarget: undefined,
    conversationState: {
      ...conversationState,
      topic: code,
      resolvedRequest: request,
      activeEntities: unique([code, ...(Array.isArray(conversationState.activeEntities) ? conversationState.activeEntities : [])], 10),
      requestedEvidence: unique(['message_text', 'trigger_rule', ...(Array.isArray(conversationState.requestedEvidence) ? conversationState.requestedEvidence : [])], 8),
      openQuestions: [],
    },
  }
  return { plan, changed: true, reason: 'exact-message-evidence' }
}

const rewriteMessage = (message: string) => {
  const match = message.match(SEMANTIC_PLAN_PATTERN)
  if (!match?.[1]) return { message, changed: false, reason: 'no-semantic-plan' }
  try {
    const rawPlan = JSON.parse(match[1])
    if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) return { message, changed: false, reason: 'invalid-plan' }
    const patched = patchPlan(rawPlan, message)
    if (!patched.changed) return { message, changed: false, reason: patched.reason }
    const block = `[JETWORK_SEMANTIC_PLAN]\n${JSON.stringify(patched.plan)}\n[END_JETWORK_SEMANTIC_PLAN]`
    return { message: message.replace(SEMANTIC_PLAN_PATTERN, block), changed: true, reason: patched.reason }
  } catch {
    return { message, changed: false, reason: 'plan-parse-failed' }
  }
}

const bodyText = async (input: RequestInfo | URL, init?: RequestInit): Promise<string | null> => {
  if (typeof init?.body === 'string') return init.body
  if (init?.body instanceof Uint8Array) return new TextDecoder().decode(init.body)
  if (input instanceof Request) return await input.clone().text().catch(() => null)
  return null
}

const downstreamFetch = globalThis.fetch.bind(globalThis)
let installed = false

export const installSemanticQualityPatch = () => {
  if (installed) return
  installed = true
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const rawUrl = input instanceof Request ? input.url : String(input)
    let pathname = ''
    try { pathname = new URL(rawUrl).pathname } catch { return downstreamFetch(input, init) }
    if (method !== 'POST' || pathname !== CORE_PATH) return downstreamFetch(input, init)

    const rawBody = await bodyText(input, init)
    if (!rawBody) return downstreamFetch(input, init)
    let parsed: Record<string, any>
    try {
      parsed = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return downstreamFetch(input, init)
    } catch {
      return downstreamFetch(input, init)
    }

    const message = String(parsed.message || '')
    const rewritten = rewriteMessage(message)
    if (!rewritten.changed) return downstreamFetch(input, init)

    parsed.message = rewritten.message
    console.info('ASSISTANT_SEMANTIC_QUALITY_PATCH', JSON.stringify({
      messageId: String(parsed.messageId || ''),
      reason: rewritten.reason,
    }))
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    headers.set('Content-Type', 'application/json')
    return downstreamFetch(rawUrl, {
      ...(init || {}),
      method: 'POST',
      headers,
      body: JSON.stringify(parsed),
    })
  }
}
