import type { ReasoningPlan } from './reasoningEngine.ts'

export const GEMINI_COST_GUARD_VERSION = 'gemini-cost-guard-v1'
export const GEMINI_AGENT_MODEL = 'gemini-3.5-flash-lite'
export const GEMINI_SEMANTIC_MODEL = 'gemini-3.1-flash-lite'
export const DEPRECATED_GEMINI_FLASH_LITE_PREVIEW = 'gemini-3.1-flash-lite-preview'

const INTERNAL_SEMANTIC_PLAN_PATTERN = /\[JETWORK_SEMANTIC_PLAN\]\s*([\s\S]*?)\s*\[END_JETWORK_SEMANTIC_PLAN\]/i
const MAX_CONVERSATION_CHARACTERS = 14_000
const MAX_CONVERSATION_ITEM_CHARACTERS = 4_000
const MAX_PROTOCOL_ITEMS = 8
const MAX_TOOL_OUTPUT_CHARACTERS = 4_500
const MAX_SYNTHESIS_EVIDENCE_CHARACTERS = 18_000
const MAX_SYNTHESIS_DRAFT_CHARACTERS = 4_000

const MODEL_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-3-flash-preview': { input: 0.5, output: 3 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
}

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const candidate = part as Record<string, unknown>
      return typeof candidate.text === 'string' ? candidate.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

const truncateText = (value: unknown, maxCharacters: number) => {
  const text = String(value ?? '')
  if (text.length <= maxCharacters) return text
  if (maxCharacters < 160) return text.slice(0, maxCharacters)
  const tail = Math.min(500, Math.floor(maxCharacters * 0.18))
  const head = maxCharacters - tail - 54
  return `${text.slice(0, Math.max(0, head))}\n[...cost guard compacted evidence...]\n${text.slice(-tail)}`
}

const conversationalItem = (item: Record<string, unknown>) => {
  const type = String(item.type || '')
  const role = String(item.role || '')
  return (!type && (role === 'user' || role === 'assistant')) || type === 'message'
}

const compactConversationItems = (items: Array<Record<string, unknown>>) => {
  const selected: Array<Record<string, unknown>> = []
  let characters = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!conversationalItem(item)) continue
    const content = textFromContent(item.content)
    if (!content) continue
    const compacted = truncateText(content, MAX_CONVERSATION_ITEM_CHARACTERS)
    if (selected.length > 0 && characters + compacted.length > MAX_CONVERSATION_CHARACTERS) break
    const role = String(item.role || '') === 'user' ? 'user' : 'assistant'
    selected.unshift({ role, content: compacted })
    characters += compacted.length
  }
  return selected
}

const protocolItems = (items: Array<Record<string, unknown>>) => items
  .map((item, index) => ({ item, index }))
  .filter(({ item }) => ['function_call', 'function_call_output'].includes(String(item.type || '')))

const compactProtocolItems = (items: Array<Record<string, unknown>>) => {
  const protocol = protocolItems(items)
  const retained = protocol.slice(-MAX_PROTOCOL_ITEMS)
  return retained.map(({ item }) => {
    if (String(item.type || '') !== 'function_call_output') return { ...item }
    return {
      ...item,
      output: truncateText(item.output, MAX_TOOL_OUTPUT_CHARACTERS),
    }
  })
}

const toolNameMap = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items) {
    if (String(item.type || '') !== 'function_call') continue
    names.set(String(item.call_id || ''), String(item.name || 'knowledge_tool'))
  }
  return names
}

const compactEvidenceText = (items: Array<Record<string, unknown>>, maxCharacters = MAX_SYNTHESIS_EVIDENCE_CHARACTERS) => {
  const names = toolNameMap(items)
  const chunks: string[] = []
  let used = 0
  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    const callId = String(item.call_id || '')
    const name = names.get(callId) || 'knowledge_tool'
    const remaining = maxCharacters - used
    if (remaining <= 0) break
    const output = truncateText(item.output, Math.min(MAX_TOOL_OUTPUT_CHARACTERS, Math.max(0, remaining - name.length - 8)))
    if (!output.trim()) continue
    const chunk = `[${name}]\n${output}`
    chunks.push(chunk)
    used += chunk.length + 2
  }
  return chunks.join('\n\n').slice(0, maxCharacters)
}

export const normalizeGeminiRequestedModel = (model: string) => (
  model === DEPRECATED_GEMINI_FLASH_LITE_PREVIEW ? GEMINI_SEMANTIC_MODEL : model
)

export const extractSemanticPlanFromItems = (items: Array<Record<string, unknown>>): ReasoningPlan | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = textFromContent(items[index].content)
    if (!text) continue
    const match = text.match(INTERNAL_SEMANTIC_PLAN_PATTERN)
    if (!match?.[1]) continue
    try {
      const parsed = JSON.parse(match[1])
      return parsed && typeof parsed === 'object' ? parsed as ReasoningPlan : null
    } catch {
      return null
    }
  }
  return null
}

export const executedToolCallCount = (items: Array<Record<string, unknown>>) => (
  items.filter(item => String(item.type || '') === 'function_call_output').length
)

export const toolBudgetForPlan = (plan: ReasoningPlan | null): number => {
  if (!plan) return 4
  if (!plan.knowledgeRequired && plan.webMode === 'none') return 0
  const high = plan.complexity === 'high'
  switch (plan.intent) {
    case 'sap_diagnosis': return high ? 5 : 4
    case 'research': return high ? 5 : 4
    case 'analysis': return high ? 5 : 4
    case 'decision': return high ? 4 : 3
    case 'project': return high ? 4 : 3
    case 'document': return plan.knowledgeRequired ? 2 : 0
    case 'simple_answer': return 0
    default: return high ? 5 : 4
  }
}

export const compactGeminiAgentItems = (items: Array<Record<string, unknown>>) => [
  ...compactConversationItems(items),
  ...compactProtocolItems(items),
]

export const buildGeminiFinalSynthesisItems = (
  items: Array<Record<string, unknown>>,
  agentDraft = '',
) => {
  const conversational = compactConversationItems(items)
  const evidence = compactEvidenceText(items)
  const draft = truncateText(agentDraft, MAX_SYNTHESIS_DRAFT_CHARACTERS)
  const sections = [
    '[JETWORK_COST_GUARD_FINAL_SYNTHESIS]',
    'Araştırma turu tamamlandı. Yeni araç çağrısı yapmadan, mevcut konuşma ve aşağıdaki kurumsal kanıtlarla nihai kullanıcı yanıtını üret.',
    'Kanıt yetersizse bunu açıkça belirt. Kullanıcının reddettiği hipotezleri yeni kanıt olmadan yeniden doğru kabul etme.',
    evidence ? `\n[JETWORK_TOOL_EVIDENCE]\n${evidence}\n[END_JETWORK_TOOL_EVIDENCE]` : '',
    draft ? `\n[JETWORK_AGENT_DRAFT]\n${draft}\n[END_JETWORK_AGENT_DRAFT]` : '',
  ].filter(Boolean)
  return [
    ...conversational,
    { role: 'user', content: sections.join('\n') },
  ]
}

export const costGuardAgentInstruction = (input: {
  budget: number
  executed: number
  plan: ReasoningPlan | null
}) => {
  const remaining = Math.max(0, input.budget - input.executed)
  const intent = input.plan?.intent || 'unknown'
  return [
    `[JETWORK_COST_GUARD ${GEMINI_COST_GUARD_VERSION}]`,
    `Intent=${intent}. Bu agent turunda kalan araç bütçesi ${remaining}.`,
    'Bir seferde en fazla bir yeni araç çağır. Aynı sorguyu gereksiz yere tekrarlama.',
    'Yeterli kanıt oluştuysa yeni araç çağırmak yerine kısa bir araştırma taslağı üret; nihai kullanıcı yanıtını güçlü sentez modeli hazırlayacak.',
  ].join(' ')
}

export const responseHasFunctionCall = (response: { output?: Array<Record<string, unknown>> }) => (
  (response.output || []).some(item => String(item.type || '') === 'function_call')
)

export const responseVisibleText = (response: { output?: Array<Record<string, unknown>> }) => (
  (response.output || [])
    .filter(item => String(item.type || '') === 'message')
    .map(item => textFromContent(item.content))
    .filter(Boolean)
    .join('\n')
    .trim()
)

export const mergeNumericUsage = (
  left?: Record<string, number>,
  right?: Record<string, number>,
): Record<string, number> | undefined => {
  if (!left && !right) return undefined
  const merged: Record<string, number> = {}
  for (const source of [left || {}, right || {}]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'number' && Number.isFinite(value)) merged[key] = (merged[key] || 0) + value
    }
  }
  return merged
}

export const usageWithGeminiEstimatedCost = (
  model: string,
  usage?: Record<string, number>,
  markers: Record<string, number> = {},
): Record<string, number> | undefined => {
  const base = { ...(usage || {}) }
  const pricing = MODEL_PRICING_USD_PER_MILLION[model]
  if (pricing) {
    const inputTokens = Number(base.input_tokens || 0)
    const billedOutputTokens = Number(base.output_tokens || 0) + Number(base.reasoning_tokens || 0)
    base.estimated_cost_usd = Number(((inputTokens * pricing.input + billedOutputTokens * pricing.output) / 1_000_000).toFixed(6))
  }
  for (const [key, value] of Object.entries(markers)) {
    if (Number.isFinite(value)) base[key] = value
  }
  return Object.keys(base).length ? base : undefined
}
