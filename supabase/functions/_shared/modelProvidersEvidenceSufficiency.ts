import {
  requestGeminiResponse as guardedRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceBoundaryGuard.ts'

export * from './modelProvidersEvidenceBoundaryGuard.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const namesByCallId = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items || []) {
    if (String(item?.type || '') === 'function_call') {
      names.set(String(item.call_id || ''), String(item.name || ''))
    }
  }
  return names
}

const verifiedMessageEvidenceCount = (items: Array<Record<string, unknown>>) => {
  const names = namesByCallId(items)
  const seen = new Set<string>()

  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const callName = names.get(String(item.call_id || '')) || ''
    const payload: any = parse(item.output)

    // Only machine-verifiable knowledge outputs are eligible for the early-stop gate.
    // Search candidates must already be promoted to VERIFIED_KNOWLEDGE_DATA, while
    // exact relation/detail tools are authoritative by construction.
    const verifiedSearch = callName === 'search_knowledge_catalog'
      && String(payload?.securityNotice || '').includes('VERIFIED_KNOWLEDGE_DATA')
    const authoritativeExact = [
      'get_objects_by_technical_reference',
      'get_message_detail',
      'list_knowledge_catalog',
    ].includes(callName)

    if (!verifiedSearch && !authoritativeExact) continue

    const records = Array.isArray(payload?.records)
      ? payload.records
      : Array.isArray(payload?.records?.items)
        ? payload.records.items
        : []

    for (const record of records) {
      if (String(record?.objectType || '') !== 'message') continue
      const key = String(record?.canonicalKey || record?.title || record?.name || '').trim()
      if (key) seen.add(key)
    }
  }

  return seen.size
}

const KNOWLEDGE_DISCOVERY_TOOLS = new Set([
  'search_knowledge_catalog',
  'search_document',
  'get_document_content',
  'get_abap_source',
  'get_message_detail',
  'get_knowledge_object',
  'get_related_objects',
  'get_objects_by_technical_reference',
  'list_class_inventory',
])

const preserveOnlyExpansionKnowledgeTool = (tools: ReadonlyArray<Record<string, unknown>>) => tools.filter(tool => {
  const name = String(tool?.name || '')
  if (!KNOWLEDGE_DISCOVERY_TOOLS.has(name)) return true
  // Keep exhaustive expansion available to the primary model. If the user really
  // asked for the whole set, the model can still select list_knowledge_catalog.
  return name === 'list_knowledge_catalog'
})

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const messageEvidenceCount = verifiedMessageEvidenceCount(input.items || [])
  if (!input.allowTools || messageEvidenceCount < 2) return guardedRequest(input)

  const reducedTools = preserveOnlyExpansionKnowledgeTool(input.tools || [])
  const response = await guardedRequest({
    ...input,
    tools: reducedTools,
  })

  return {
    ...response,
    usage: {
      ...(response.usage || {}),
      evidence_sufficiency_gate: 1,
      evidence_sufficiency_message_records: messageEvidenceCount,
      evidence_sufficiency_discovery_tools_removed: Math.max(0, (input.tools || []).length - reducedTools.length),
    },
  }
}
