import {
  requestGeminiResponse as guardedRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceBoundaryGuard.ts'

export * from './modelProvidersEvidenceBoundaryGuard.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const CARDINALITY_CONTRACT = `\n\n[JETWORK PRIMARY INVENTORY CARDINALITY]\nFor structured technical catalog questions, you decide cardinality explicitly. If the user asks an open-ended inventory question with no explicit bound, choose complete. Choose preview only when the user explicitly asks for a few/examples/representative/sample/short subset or otherwise gives a bounded amount. Keep that semantic choice stable within the same turn.`

const callsById = (items: Array<Record<string, unknown>>) => {
  const calls = new Map<string, { name: string; args: any }>()
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call') continue
    calls.set(String(item.call_id || ''), { name: String(item.name || ''), args: parse(item.arguments) || {} })
  }
  return calls
}

const recordList = (payload: any): any[] => {
  if (Array.isArray(payload?.records)) return payload.records
  if (Array.isArray(payload?.records?.items)) return payload.records.items
  return []
}

const normalizeIdentifier = (value: unknown) => String(value || '').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
const canonicalLeaf = (key: unknown) => {
  const body = String(key || '').split(':').slice(1).join(':')
  return body.split('/').pop() || body
}

const pendingImplementationVerification = (items: Array<Record<string, unknown>>) => {
  const calls = callsById(items)
  const fetched = new Set<string>()
  for (const call of calls.values()) {
    if (call.name === 'get_abap_source') {
      const key = String(call.args?.canonicalKey || '').trim()
      if (key) fetched.add(key)
    }
  }

  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const call = calls.get(String(item.call_id || ''))
    if (!call || call.name !== 'get_objects_by_technical_reference') continue
    if (String(call.args?.verificationMode || '') !== 'implementation') continue
    const requestedTypes = Array.isArray(call.args?.objectTypes) ? call.args.objectTypes.map(String) : []
    // A request explicitly targeting message relations is relation evidence, even if the model
    // accidentally labels the verification mode as implementation. Source verification is only
    // mandatory for code-bearing technical objects.
    if (requestedTypes.includes('message')) continue

    const payload: any = parse(item.output)
    const records = recordList(payload).filter((record: any) => (
      ['method', 'function', 'class'].includes(String(record?.objectType || '')) && String(record?.canonicalKey || '').trim()
    ))
    if (!records.length) continue

    const target = normalizeIdentifier(call.args?.technicalReference)
    const exact = records.find((record: any) => normalizeIdentifier(canonicalLeaf(record?.canonicalKey)) === target)
      || records.find((record: any) => normalizeIdentifier(record?.name) === target)
      || records[0]
    const key = String(exact?.canonicalKey || '').trim()
    if (key && !fetched.has(key)) return key
  }
  return null
}

const pendingDocumentVerification = (items: Array<Record<string, unknown>>) => {
  const calls = callsById(items)
  const fetched = new Set<string>()
  let latestSingleCandidate: string | null = null
  for (const item of items || []) {
    if (String(item?.type || '') === 'function_call') {
      const name = String(item.name || '')
      const args = parse(item.arguments) || {}
      if (name === 'get_document_content') {
        const key = String(args?.canonicalKey || '').trim()
        if (key) fetched.add(key)
      }
      continue
    }
    if (String(item?.type || '') !== 'function_call_output') continue
    const call = calls.get(String(item.call_id || '')) || { name: '', args: {} }
    if (call.name !== 'search_document') continue
    const payload: any = parse(item.output)
    const keys = [...new Set(recordList(payload).map((record: any) => String(record?.canonicalKey || '').trim()).filter(Boolean))]
    latestSingleCandidate = keys.length === 1 ? keys[0] : null
  }
  if (!latestSingleCandidate || fetched.has(latestSingleCandidate)) return null
  return latestSingleCandidate
}

const firstSearchCardinality = (items: Array<Record<string, unknown>>) => {
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call' || String(item?.name || '') !== 'search_knowledge_catalog') continue
    const args: any = parse(item.arguments) || {}
    const mode = String(args?.resultMode || '')
    if (mode === 'preview' || mode === 'complete') return mode
  }
  return null
}

const enforceSearchCardinality = (response: NormalizedModelResponse, lockedMode: string | null): NormalizedModelResponse => {
  if (!lockedMode) return response
  let rewrites = 0
  const output = (response.output || []).map((item: any) => {
    if (item?.type !== 'function_call' || item?.name !== 'search_knowledge_catalog') return item
    const args: any = parse(item.arguments) || {}
    if (String(args?.resultMode || '') === lockedMode) return item
    rewrites += 1
    return { ...item, arguments: JSON.stringify({ ...args, resultMode: lockedMode }) }
  })
  return rewrites ? { ...response, output, usage: { ...(response.usage || {}), deterministic_cardinality_mode_lock: rewrites } } : response
}

type SufficiencyState = {
  messageCount: number
  mode: 'none' | 'preview' | 'complete_pending' | 'authoritative'
  familyTotal?: number
  familyPrefix?: string
  familyObjectType?: string
}

const exactCallExplicitlyRequestedMessages = (call: { name: string; args: any }) => {
  if (call.name === 'get_message_detail') return true
  if (call.name !== 'get_objects_by_technical_reference') return false
  const requested = Array.isArray(call.args?.objectTypes) ? call.args.objectTypes.map(String) : []
  return requested.includes('message')
}

const evidenceState = (items: Array<Record<string, unknown>>): SufficiencyState => {
  const calls = callsById(items)
  const seen = new Set<string>()
  let mode: SufficiencyState['mode'] = 'none'
  let familyTotal: number | undefined
  let familyPrefix: string | undefined
  let familyObjectType: string | undefined
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const call = calls.get(String(item.call_id || '')) || { name: '', args: {} }
    const payload: any = parse(item.output)
    const verifiedSearch = call.name === 'search_knowledge_catalog' && String(payload?.securityNotice || '').includes('VERIFIED_KNOWLEDGE_DATA')
    const authoritativeExact = call.name === 'list_knowledge_catalog' || exactCallExplicitlyRequestedMessages(call)
    if (!verifiedSearch && !authoritativeExact) continue
    const records = recordList(payload)
    for (const record of records) {
      if (String(record?.objectType || '') !== 'message') continue
      const key = String(record?.canonicalKey || record?.title || record?.name || '').trim()
      if (key) seen.add(key)
    }
    if (call.name === 'list_knowledge_catalog' && payload?.records?.complete === true) {
      mode = 'authoritative'; familyTotal = Number(payload?.records?.totalCount || seen.size) || familyTotal; continue
    }
    if (exactCallExplicitlyRequestedMessages(call) && records.some((record: any) => String(record?.objectType || '') === 'message')) {
      const requestedMode = String(payload?.resultMode || call.args?.resultMode || 'complete')
      mode = requestedMode === 'preview' ? 'preview' : 'authoritative'
      continue
    }
    if (verifiedSearch && records.some((record: any) => String(record?.objectType || '') === 'message')) {
      const requestedMode = String(payload?.resultMode || call.args?.resultMode || 'preview') === 'complete' ? 'complete' : 'preview'
      const families = Array.isArray(payload?.catalogFamilies) ? payload.catalogFamilies : []
      const largestFamily = families.reduce((best: any, family: any) => Number(family?.totalCount || 0) > Number(best?.totalCount || 0) ? family : best, null)
      const largestCount = Number(largestFamily?.totalCount || 0)
      if (largestCount > 0) {
        familyTotal = largestCount
        familyPrefix = String(largestFamily?.prefix || '').trim() || familyPrefix
        familyObjectType = String(largestFamily?.objectType || 'message').trim() || familyObjectType
      }
      mode = requestedMode === 'complete' && largestCount > seen.size ? 'complete_pending' : requestedMode === 'complete' ? 'authoritative' : 'preview'
    }
  }
  return { messageCount: seen.size, mode, familyTotal, familyPrefix, familyObjectType }
}

const previewMessageRows = (items: Array<Record<string, unknown>>) => {
  const calls = callsById(items)
  const rows: any[] = []
  const seen = new Set<string>()
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const call = calls.get(String(item.call_id || '')) || { name: '', args: {} }
    const payload: any = parse(item.output)
    const mode = String(payload?.resultMode || call.args?.resultMode || '')
    if (mode !== 'preview') continue
    if (!['search_knowledge_catalog', 'get_objects_by_technical_reference'].includes(call.name)) continue
    for (const record of recordList(payload)) {
      if (String(record?.objectType || '') !== 'message') continue
      const key = String(record?.canonicalKey || record?.title || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key); rows.push(record)
    }
  }
  return rows.slice(0, 5)
}

const renderVerifiedMessageRows = (input: any, rows: any[], usageKey: string): NormalizedModelResponse => {
  const lines = rows.map(row => {
    const title = String(row?.title || row?.name || row?.canonicalKey || '').trim()
    const match = title.match(/^([^—]+)\s*—\s*(.+)$/)
    return match ? `- **${match[1].trim()}** — ${match[2].trim()}` : `- ${title}`
  }).filter(Boolean)
  const text = lines.join('\n')
  input.onText(text)
  return {
    id: `jetwork-verified-message-preview:${crypto.randomUUID()}`,
    status: 'completed',
    model: String(input.model || 'gemini-3.5-flash'),
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { [usageKey]: 1, deterministic_provider_calls_avoided: 1 },
  } as NormalizedModelResponse
}

const KNOWLEDGE_DISCOVERY_TOOLS = new Set(['search_knowledge_catalog','search_document','get_document_content','get_abap_source','get_message_detail','get_knowledge_object','get_related_objects','get_objects_by_technical_reference','list_class_inventory','list_knowledge_catalog'])
const restrictKnowledgeTools = (tools: ReadonlyArray<Record<string, unknown>>, mode: SufficiencyState['mode']) => tools.filter(tool => {
  const name = String(tool?.name || '')
  if (!KNOWLEDGE_DISCOVERY_TOOLS.has(name)) return true
  return mode === 'complete_pending' && name === 'list_knowledge_catalog'
})

const syntheticToolCall = (input: any, name: string, args: Record<string, unknown>, usage: Record<string, number>): NormalizedModelResponse => ({
  id: `jetwork-synthetic-tool:${crypto.randomUUID()}`, status: 'completed', model: String(input.model || 'gemini-3.5-flash'),
  output: [{ type: 'function_call', name, call_id: `synthetic:${crypto.randomUUID()}`, arguments: JSON.stringify(args) }], usage,
} as NormalizedModelResponse)

const syntheticCompleteEnumeration = (input: any, state: SufficiencyState): NormalizedModelResponse | null => {
  if (state.mode !== 'complete_pending' || !state.familyPrefix) return null
  return syntheticToolCall(input, 'list_knowledge_catalog', {
    objectType: state.familyObjectType === 'mixed' ? 'message' : (state.familyObjectType || 'message'), prefix: state.familyPrefix,
    cursor: null, limit: 25, responseMode: 'complete',
  }, { evidence_sufficiency_gate: 1, evidence_sufficiency_mode_complete_pending: 1, evidence_sufficiency_message_records: state.messageCount,
    evidence_sufficiency_family_total: state.familyTotal || 0, deterministic_complete_cardinality_dispatch: 1, deterministic_provider_calls_avoided: 1 })
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const baseInstructions = `${input.instructions}${CARDINALITY_CONTRACT}`
  if (input.allowTools) {
    const implementationKey = pendingImplementationVerification(input.items || [])
    if (implementationKey) return syntheticToolCall(input, 'get_abap_source', { canonicalKey: implementationKey }, { deterministic_implementation_verification_dispatch: 1, deterministic_provider_calls_avoided: 1 })
    const documentKey = pendingDocumentVerification(input.items || [])
    if (documentKey) return syntheticToolCall(input, 'get_document_content', { canonicalKey: documentKey }, { deterministic_document_verification_dispatch: 1, deterministic_provider_calls_avoided: 1 })
  }

  const state = evidenceState(input.items || [])
  if (input.allowTools && state.mode === 'preview' && state.messageCount >= 2) {
    const rows = previewMessageRows(input.items || [])
    if (rows.length) return renderVerifiedMessageRows(input, rows, 'deterministic_verified_message_preview_render')
  }

  const lockedMode = firstSearchCardinality(input.items || [])
  if (!input.allowTools || state.messageCount < 2 || state.mode === 'none') {
    const response = await guardedRequest({ ...input, instructions: baseInstructions })
    return enforceSearchCardinality(response, lockedMode)
  }
  const completeDispatch = syntheticCompleteEnumeration(input, state)
  if (completeDispatch) return completeDispatch
  const reducedTools = restrictKnowledgeTools(input.tools || [], state.mode)
  const response = await guardedRequest({ ...input, instructions: `${baseInstructions}\n\n[JETWORK EVIDENCE SUFFICIENCY]\nVerified message evidence is sufficient for the cardinality already chosen by the primary model. Research is finished for this turn. Do not call additional knowledge discovery tools. Answer only from the verified evidence already present.`, tools: reducedTools, allowTools: reducedTools.length > 0 })
  const locked = enforceSearchCardinality(response, lockedMode)
  return { ...locked, usage: { ...(locked.usage || {}), evidence_sufficiency_gate: 1, evidence_sufficiency_message_records: state.messageCount,
    evidence_sufficiency_mode_preview: state.mode === 'preview' ? 1 : 0, evidence_sufficiency_mode_complete_pending: 0,
    evidence_sufficiency_mode_authoritative: state.mode === 'authoritative' ? 1 : 0, evidence_sufficiency_family_total: state.familyTotal || 0,
    evidence_sufficiency_discovery_tools_removed: Math.max(0, (input.tools || []).length - reducedTools.length) } }
}
