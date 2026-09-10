export const OLLAMA_MODEL_PREFIX = 'ollama:'
export const DEFAULT_OLLAMA_MODEL = 'ollama:qwen3:4b-instruct'
export const OLLAMA_MODELS = new Set([DEFAULT_OLLAMA_MODEL])
export const OLLAMA_CONTROLLER_CONTEXT_TOKENS = 16_384
export const OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS = 320
export const OLLAMA_ARGUMENT_SIGNATURE_MAX_CHARACTERS = 210
export const OLLAMA_TOOL_DISPATCHER_NAME = 'call_jetwork_tool'
export const OLLAMA_DISPATCHER_ENTRY_MAX_CHARACTERS = 145

export type OllamaNormalizedResponse = {
  id?: string
  status?: string
  model?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, number>
  error?: { message?: string }
  incomplete_details?: { reason?: string }
}

const clean = (value: unknown) => String(value ?? '').trim()

export const isOllamaModel = (model: string) => OLLAMA_MODELS.has(clean(model))

export const ollamaExecutionModel = (model: string) => {
  const normalized = clean(model)
  if (!normalized.startsWith(OLLAMA_MODEL_PREFIX)) return normalized
  return normalized.slice(OLLAMA_MODEL_PREFIX.length)
}

const textFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => {
    if (typeof part === 'string') return part
    if (!part || typeof part !== 'object') return ''
    const candidate = part as Record<string, unknown>
    return typeof candidate.text === 'string' ? candidate.text : ''
  }).filter(Boolean).join('\n')
}

const compactText = (value: string, maxCharacters: number) => {
  if (value.length <= maxCharacters) return value
  const head = Math.floor(maxCharacters * 0.45)
  const tail = Math.max(0, maxCharacters - head)
  return `${value.slice(0, head)}\n[...JetWork local context compacted...]\n${value.slice(-tail)}`
}

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_name?: string
  tool_calls?: Array<{
    type: 'function'
    function: { name: string; arguments: Record<string, unknown> }
  }>
}

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

// Compatibility normalizer retained for direct callers/tests. Canonical JetWork
// schemas remain authoritative. Ollama uses a single dispatcher grammar below;
// JetWork still validates the unwrapped canonical call before execution.
const OLLAMA_SCHEMA_DROP_KEYS = new Set([
  'description', 'title', '$comment', 'examples', 'example', 'default',
  'readOnly', 'writeOnly', 'deprecated', 'minLength', 'maxLength',
  'minimum', 'maximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'additionalProperties',
])

const OLLAMA_DESCRIPTION_OVERRIDES: Record<string, string> = {
  search_knowledge_catalog: 'Search Jetbase for ranked candidate knowledge; results are discovery candidates, not exact evidence.',
  list_knowledge_catalog: 'Enumerate published Jetbase objects by type or prefix.',
  list_class_inventory: 'Enumerate the published ABAP class inventory.',
  get_abap_source: 'Read exact published ABAP class, method or function source.',
  get_message_detail: 'Read exact published CRM or ABAP message detail.',
  search_document: 'Search published Jetbase documents and business rules.',
  get_document_content: 'Read exact published document or business-rule content.',
  get_knowledge_object: 'Read one exact published Jetbase object.',
  get_knowledge_objects: 'Read a bounded set of exact published Jetbase objects.',
  get_related_objects: 'Read published relations and related objects for one Jetbase object.',
  get_knowledge_evidence_pack: 'Read a bounded published Jetbase evidence subgraph.',
  search_web: 'Search the public web for discovery candidates; results are not exact evidence.',
  record_project_memory: 'Persist one durable user-stated project decision, fact or correction.',
  review_evidence_coverage: 'Review verified current-turn evidence coverage, gaps and conflicts.',
  report_progress: 'Publish a short user-visible Agent Work update.',
  request_large_context: 'Read a larger bounded slice of prior JetWork conversation context.',
}

const OLLAMA_ARGUMENT_SIGNATURE_OVERRIDES: Record<string, string> = {
  transform_spreadsheet_file: 'attachmentId:string; operation:sort|filter|deduplicate|clean|normalize|aggregate|join; operation args: sheetName,keyColumns,column,direction,equalsValue,groupByColumns,valueColumn,aggregation,secondaryAttachmentId,secondarySheetName,secondaryKeyColumn,copyColumns,outputSheetName,outputFileName',
  sync_spreadsheet_with_jira_export: 'targetAttachmentId,jiraAttachmentId,targetSheetName,jiraSheetName,targetKeyColumn,jiraKeyColumn,jiraStatusColumn,targetStatusColumn,doneStatuses[],completedValue,jiraSprintColumn,targetSprintColumn,sprintNamePattern,outputFileName',
  edit_spreadsheet_file: 'attachmentId:string; sheetName:string|null; actions:[{operation,target,value,number}]; outputFileName:string|null',
  create_document_file: 'format:docx|pptx; fileName,title,markdown,headerText,footerText; metadata:[{label,value}]; paragraphs:string[]; slides:[{title,body}]',
  review_evidence_coverage: 'aspects:[{id,label,evidenceIds:string[],status:covered|partial|open}]; conflicts:[{key,evidenceIds:string[]}]',
}

const schemaTypeLabel = (value: unknown): string => {
  if (!isRecord(value)) return 'any'
  const rawTypes = Array.isArray(value.type)
    ? value.type.map(clean).filter(Boolean)
    : value.type ? [clean(value.type)] : []
  const nullable = rawTypes.includes('null')
  const types = rawTypes.filter(type => type !== 'null')
  let label = types.join('|') || 'any'
  if (label === 'array') {
    const items = isRecord(value.items) ? value.items : {}
    const itemTypes = Array.isArray(items.type)
      ? items.type.map(clean).filter(type => type && type !== 'null')
      : items.type ? [clean(items.type)] : []
    label = `${itemTypes.join('|') || 'any'}[]`
  }
  const enumValues = Array.isArray(value.enum)
    ? value.enum.filter(item => item !== null).map(item => clean(item)).filter(Boolean)
    : []
  if (enumValues.length > 0 && enumValues.length <= 8) label += `=${enumValues.join('|')}`
  return nullable ? `${label}|null` : label
}

const boundedSignature = (parts: string[]) => {
  const accepted: string[] = []
  let length = 0
  for (const part of parts) {
    const extra = (accepted.length ? 2 : 0) + part.length
    if (length + extra > OLLAMA_ARGUMENT_SIGNATURE_MAX_CHARACTERS) break
    accepted.push(part)
    length += extra
  }
  return accepted.length < parts.length ? `${accepted.join(', ')}, …` : accepted.join(', ')
}

export const compactOllamaArgumentSignature = (name: string, parameters: unknown): string => {
  const override = clean(OLLAMA_ARGUMENT_SIGNATURE_OVERRIDES[name])
  if (override) return override.length <= OLLAMA_ARGUMENT_SIGNATURE_MAX_CHARACTERS
    ? override
    : `${override.slice(0, OLLAMA_ARGUMENT_SIGNATURE_MAX_CHARACTERS - 1).trimEnd()}…`
  if (!isRecord(parameters) || !isRecord(parameters.properties)) return ''
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.map(clean) : [])
  const parts = Object.entries(parameters.properties).map(([key, schema]) => (
    `${key}${required.has(key) ? '' : '?'}:${schemaTypeLabel(schema)}`
  ))
  return boundedSignature(parts)
}

export const compactOllamaToolDescription = (
  name: string,
  description: unknown,
  parameters?: unknown,
): string => {
  const override = OLLAMA_DESCRIPTION_OVERRIDES[name]
  const source = clean(override || description).replace(/\s+/gu, ' ')
  const firstSentence = source.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() || source
  const summary = firstSentence.length <= 90 ? firstSentence : `${firstSentence.slice(0, 89).trimEnd()}…`
  const signature = compactOllamaArgumentSignature(name, parameters)
  const result = [summary, signature ? `Args: ${signature}` : ''].filter(Boolean).join(' ')
  return result.length <= OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS
    ? result
    : `${result.slice(0, OLLAMA_TOOL_DESCRIPTION_MAX_CHARACTERS - 1).trimEnd()}…`
}

const normalizeOllamaSchemaNode = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeOllamaSchemaNode)
  if (!isRecord(value)) return value
  const normalized: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (OLLAMA_SCHEMA_DROP_KEYS.has(key)) continue
    normalized[key] = normalizeOllamaSchemaNode(nested)
  }
  const properties = normalized.properties
  if (normalized.type === 'object' && isRecord(properties) && Object.keys(properties).length === 0) {
    delete normalized.properties
    delete normalized.required
  }
  return normalized
}

export const normalizeOllamaToolParameters = (value: unknown): Record<string, unknown> => {
  const normalized = normalizeOllamaSchemaNode(value)
  return isRecord(normalized) ? normalized : { type: 'object' }
}

const logicalFunctionTools = (tools: ReadonlyArray<Record<string, unknown>>) => tools.flatMap(tool => {
  if (clean(tool.type) !== 'function') return []
  const name = clean(tool.name)
  return name ? [{ ...tool, name }] : []
})

const dispatcherEntry = (tool: Record<string, unknown>) => {
  const name = clean(tool.name)
  const signature = compactOllamaArgumentSignature(name, tool.parameters)
  const summarySource = clean(OLLAMA_DESCRIPTION_OVERRIDES[name] || tool.description).replace(/\s+/gu, ' ')
  const summary = summarySource.split(/[.!?]/u)[0]?.trim() || ''
  const compactSummary = summary.length <= 34 ? summary : `${summary.slice(0, 33).trimEnd()}…`
  const raw = `${name}${signature ? `(${signature})` : '()'}${compactSummary ? ` — ${compactSummary}` : ''}`
  return raw.length <= OLLAMA_DISPATCHER_ENTRY_MAX_CHARACTERS
    ? raw
    : `${raw.slice(0, OLLAMA_DISPATCHER_ENTRY_MAX_CHARACTERS - 1).trimEnd()}…`
}

export const buildOllamaDispatcherCatalog = (tools: ReadonlyArray<Record<string, unknown>>) => (
  logicalFunctionTools(tools).map(dispatcherEntry).join('\n')
)

// Preserve the complete logical JetWork capability surface, but expose only one
// native Ollama function. llama.cpp otherwise compiles one constrained grammar per
// tool and local CPU latency grows before prompt evaluation even starts.
export const toOllamaTools = (tools: ReadonlyArray<Record<string, unknown>>) => {
  const logicalTools = logicalFunctionTools(tools)
  if (!logicalTools.length) return []
  const names = logicalTools.map(tool => clean(tool.name))
  const catalog = logicalTools.map(dispatcherEntry).join('\n')
  return [{
    type: 'function',
    function: {
      name: OLLAMA_TOOL_DISPATCHER_NAME,
      description: [
        'Invoke exactly one available JetWork capability. If no capability is needed, answer normally instead of calling this function.',
        'Set name to one listed capability. Set arguments_json to one JSON object matching its signature. Never invent a capability name.',
        'Available capabilities:',
        catalog,
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: names },
          arguments_json: { type: 'string' },
        },
        required: ['name', 'arguments_json'],
      },
    },
  }]
}

export const unwrapOllamaToolCall = (
  call: unknown,
  allowedToolNames: ReadonlySet<string>,
): { name: string; arguments: Record<string, unknown> } | null => {
  if (!isRecord(call) || !isRecord(call.function)) return null
  const providerName = clean(call.function.name)
  const providerArguments = parseArguments(call.function.arguments)

  if (providerName === OLLAMA_TOOL_DISPATCHER_NAME) {
    const name = clean(providerArguments.name)
    if (!name || !allowedToolNames.has(name)) return null
    return { name, arguments: parseArguments(providerArguments.arguments_json) }
  }

  // Backward compatibility for an in-flight response from the former direct
  // multi-tool representation during a rolling deployment.
  if (!allowedToolNames.has(providerName)) return null
  return { name: providerName, arguments: providerArguments }
}

const toOllamaMessages = (
  instructions: string,
  items: Array<Record<string, unknown>>,
  maxContextCharacters: number,
  useDispatcher: boolean,
): OllamaMessage[] => {
  const callNames = new Map<string, string>()
  const converted: OllamaMessage[] = []
  const systemParts = [instructions]

  for (const item of items) {
    const type = clean(item.type)
    const role = clean(item.role)
    if (role === 'developer' || role === 'system') {
      const text = textFromContent(item.content)
      if (text) systemParts.push(text)
      continue
    }
    if (!type && (role === 'user' || role === 'assistant')) {
      const content = textFromContent(item.content)
      if (content) converted.push({ role: role as 'user' | 'assistant', content })
      continue
    }
    if (type === 'message') {
      const content = textFromContent(item.content)
      if (content) converted.push({ role: role === 'user' ? 'user' : 'assistant', content })
      continue
    }
    if (type === 'function_call') {
      const callId = clean(item.call_id)
      const name = clean(item.name)
      const canonicalArguments = parseArguments(item.arguments)
      const providerName = useDispatcher ? OLLAMA_TOOL_DISPATCHER_NAME : name
      if (callId) callNames.set(callId, providerName)
      if (name) {
        converted.push({
          role: 'assistant', content: '',
          tool_calls: [{
            type: 'function',
            function: {
              name: providerName,
              arguments: useDispatcher
                ? { name, arguments_json: JSON.stringify(canonicalArguments) }
                : canonicalArguments,
            },
          }],
        })
      }
      continue
    }
    if (type === 'function_call_output') {
      const callId = clean(item.call_id)
      const name = callNames.get(callId) || (useDispatcher ? OLLAMA_TOOL_DISPATCHER_NAME : 'knowledge_tool')
      const content = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
      converted.push({ role: 'tool', tool_name: name, content })
    }
  }

  const systemBudget = Math.min(6_000, Math.max(2_000, Math.floor(maxContextCharacters * 0.4)))
  const messages: OllamaMessage[] = [{
    role: 'system',
    content: compactText(systemParts.filter(Boolean).join('\n\n'), systemBudget),
  }]
  let remaining = Math.max(2_000, maxContextCharacters - (messages[0].content?.length || 0))
  const recent: OllamaMessage[] = []
  for (let index = converted.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = converted[index]
    const content = message.content || ''
    const allowance = Math.min(6_000, remaining)
    const compacted = compactText(content, allowance)
    recent.unshift({ ...message, content: compacted })
    remaining -= compacted.length
  }
  return [...messages, ...recent]
}

const durationMs = (value: unknown) => {
  const nanoseconds = Number(value || 0)
  return Number.isFinite(nanoseconds) && nanoseconds > 0 ? Math.round(nanoseconds / 1_000_000) : 0
}

export async function requestOllamaResponse(input: {
  gatewayUrl: string
  gatewayToken: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  maxOutputTokens: number
  maxContextCharacters?: number
  onText: (text: string) => void
  signal?: AbortSignal
}): Promise<OllamaNormalizedResponse> {
  const gatewayUrl = clean(input.gatewayUrl).replace(/\/$/, '')
  const gatewayToken = clean(input.gatewayToken)
  if (!/^https:\/\//i.test(gatewayUrl)) throw new Error('OLLAMA_GATEWAY_URL must be an HTTPS URL.')
  if (gatewayToken.length < 24) throw new Error('OLLAMA_GATEWAY_TOKEN is not configured.')
  if (!isOllamaModel(input.model)) throw new Error(`Unsupported Ollama model: ${input.model}`)

  const model = ollamaExecutionModel(input.model)
  const logicalTools = input.allowTools ? logicalFunctionTools(input.tools) : []
  const tools = logicalTools.length ? toOllamaTools(logicalTools) : []
  const useDispatcher = tools.length > 0
  const messages = toOllamaMessages(
    input.instructions,
    input.items,
    input.maxContextCharacters ?? 14_000,
    useDispatcher,
  )
  const toolPayloadCharacters = tools.length ? JSON.stringify(tools).length : 0
  const messagePayloadCharacters = JSON.stringify(messages).length
  const requestStartedAt = performance.now()
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: 'POST', signal: input.signal,
    headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages, ...(tools.length ? { tools } : {}), think: false, stream: false,
      options: {
        num_ctx: OLLAMA_CONTROLLER_CONTEXT_TOKENS,
        num_predict: Math.max(64, Math.min(input.maxOutputTokens, 1_200)),
      },
    }),
  })

  const payload = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) {
    const detail = clean(payload?.error || payload?.message).slice(0, 1_000)
    throw new Error(detail || `Ollama gateway returned ${response.status}.`)
  }

  const message = payload?.message && typeof payload.message === 'object' ? payload.message : {}
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const visibleText = clean(message.content)
  const allowedToolNames = new Set(logicalTools.map(tool => clean(tool.name)))
  const normalizedToolCalls = toolCalls.flatMap((call: unknown) => {
    const normalized = unwrapOllamaToolCall(call, allowedToolNames)
    return normalized ? [normalized] : []
  })
  if (toolCalls.length && normalizedToolCalls.length !== toolCalls.length) {
    throw new Error('Ollama dispatcher returned an unknown or malformed JetWork tool call.')
  }

  const output: Array<Record<string, unknown>> = normalizedToolCalls.length
    ? normalizedToolCalls.map(call => ({
        type: 'function_call',
        call_id: `ollama:${crypto.randomUUID()}`,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }))
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: visibleText, annotations: [] }] }]

  if (!normalizedToolCalls.length && visibleText) input.onText(visibleText)
  const promptTokens = Number(payload.prompt_eval_count || 0)
  const outputTokens = Number(payload.eval_count || 0)
  const providerTotalMs = Math.max(0, Math.round(performance.now() - requestStartedAt))
  return {
    id: `ollama:${crypto.randomUUID()}`, status: 'completed', model: input.model, output,
    usage: {
      input_tokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
      total_tokens: (Number.isFinite(promptTokens) ? promptTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0),
      ollama_provider_total_ms: providerTotalMs,
      ollama_model_total_ms: durationMs(payload.total_duration),
      ollama_load_ms: durationMs(payload.load_duration),
      ollama_prompt_eval_ms: durationMs(payload.prompt_eval_duration),
      ollama_eval_ms: durationMs(payload.eval_duration),
      ollama_tool_calls: normalizedToolCalls.length,
      ollama_tool_count: logicalTools.length,
      ollama_native_tool_count: tools.length,
      ollama_tool_payload_chars: toolPayloadCharacters,
      ollama_message_payload_chars: messagePayloadCharacters,
    },
  }
}
