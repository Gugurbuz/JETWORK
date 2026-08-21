import {
  requestGeminiResponse as guardedRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceBoundaryGuard.ts'

export * from './modelProvidersEvidenceBoundaryGuard.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const callsById = (items: Array<Record<string, unknown>>) => {
  const calls = new Map<string, { name: string; args: any }>()
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call') continue
    calls.set(String(item.call_id || ''), {
      name: String(item.name || ''),
      args: parse(item.arguments) || {},
    })
  }
  return calls
}

type SufficiencyState = {
  messageCount: number
  mode: 'none' | 'preview' | 'complete_pending' | 'authoritative'
  familyTotal?: number
}

const evidenceState = (items: Array<Record<string, unknown>>): SufficiencyState => {
  const calls = callsById(items)
  const seen = new Set<string>()
  let mode: SufficiencyState['mode'] = 'none'
  let familyTotal: number | undefined

  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const call = calls.get(String(item.call_id || '')) || { name: '', args: {} }
    const payload: any = parse(item.output)

    const verifiedSearch = call.name === 'search_knowledge_catalog'
      && String(payload?.securityNotice || '').includes('VERIFIED_KNOWLEDGE_DATA')
    const authoritativeExact = [
      'get_objects_by_technical_reference',
      'get_message_detail',
      'list_knowledge_catalog',
    ].includes(call.name)

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

    if (call.name === 'list_knowledge_catalog' && payload?.records?.complete === true) {
      mode = 'authoritative'
      familyTotal = Number(payload?.records?.totalCount || seen.size) || familyTotal
      continue
    }

    if (['get_objects_by_technical_reference', 'get_message_detail'].includes(call.name) && records.length) {
      mode = 'authoritative'
      continue
    }

    if (verifiedSearch && records.some((record: any) => String(record?.objectType || '') === 'message')) {
      const requestedMode = String(payload?.resultMode || call.args?.resultMode || 'preview') === 'complete'
        ? 'complete'
        : 'preview'
      const families = Array.isArray(payload?.catalogFamilies) ? payload.catalogFamilies : []
      const largestFamily = families.reduce((max: number, family: any) => Math.max(max, Number(family?.totalCount || 0)), 0)
      familyTotal = largestFamily || familyTotal
      mode = requestedMode === 'complete' && largestFamily > seen.size
        ? 'complete_pending'
        : requestedMode === 'complete'
          ? 'authoritative'
          : 'preview'
    }
  }

  return { messageCount: seen.size, mode, familyTotal }
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
  'list_knowledge_catalog',
])

const restrictKnowledgeTools = (
  tools: ReadonlyArray<Record<string, unknown>>,
  mode: SufficiencyState['mode'],
) => tools.filter(tool => {
  const name = String(tool?.name || '')
  if (!KNOWLEDGE_DISCOVERY_TOOLS.has(name)) return true
  return mode === 'complete_pending' && name === 'list_knowledge_catalog'
})

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const state = evidenceState(input.items || [])
  if (!input.allowTools || state.messageCount < 2 || state.mode === 'none') return guardedRequest(input)

  const reducedTools = restrictKnowledgeTools(input.tools || [], state.mode)
  const modeInstruction = state.mode === 'complete_pending'
    ? `\n\n[JETWORK EVIDENCE SUFFICIENCY]\nYou already chose resultMode="complete" for the structured catalog search. The verified preview belongs to a larger family${state.familyTotal ? ` of ${state.familyTotal} records` : ''}. Research may continue only with list_knowledge_catalog. Call that tool to obtain the authoritative complete family before finalizing. Do not switch back to document or semantic discovery.`
    : `\n\n[JETWORK EVIDENCE SUFFICIENCY]\nVerified message evidence is sufficient for the cardinality you already chose. Research is finished for this turn. Do not call additional knowledge discovery tools. Answer only from the verified evidence already present.`

  const response = await guardedRequest({
    ...input,
    instructions: `${input.instructions}${modeInstruction}`,
    tools: reducedTools,
    allowTools: reducedTools.length > 0,
  })

  return {
    ...response,
    usage: {
      ...(response.usage || {}),
      evidence_sufficiency_gate: 1,
      evidence_sufficiency_message_records: state.messageCount,
      evidence_sufficiency_mode_preview: state.mode === 'preview' ? 1 : 0,
      evidence_sufficiency_mode_complete_pending: state.mode === 'complete_pending' ? 1 : 0,
      evidence_sufficiency_mode_authoritative: state.mode === 'authoritative' ? 1 : 0,
      evidence_sufficiency_family_total: state.familyTotal || 0,
      evidence_sufficiency_discovery_tools_removed: Math.max(0, (input.tools || []).length - reducedTools.length),
    },
  }
}
