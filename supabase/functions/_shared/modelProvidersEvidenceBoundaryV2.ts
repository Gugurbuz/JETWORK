import {
  requestGeminiResponse as evidenceQualityRequest,
  type NormalizedModelResponse,
} from './modelProvidersEvidenceQuality.ts'
import { requestGeminiResponse as rawRequest } from './modelProviders.ts'

export * from './modelProvidersEvidenceQuality.ts'

const parse = (value: unknown) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null }
}

const toolNames = (items: Array<Record<string, unknown>>) => {
  const names = new Map<string, string>()
  for (const item of items || []) {
    if (String(item?.type || '') === 'function_call') {
      names.set(String(item.call_id || ''), String(item.name || 'knowledge_tool'))
    }
  }
  return names
}

const compactRecord = (record: any) => ({
  canonicalKey: record?.canonicalKey,
  objectType: record?.objectType,
  name: record?.name,
  title: record?.title,
  summary: record?.summary,
  scope: record?.scope,
  relationOnly: record?.relationOnly === true,
  implementationMaterialized: record?.implementationMaterialized,
})

const sanitizePayload = (payload: any) => {
  if (!payload || typeof payload !== 'object') return payload
  const sanitized: any = {
    tool: payload.tool,
    technicalReference: payload.technicalReference,
    canonicalKey: payload.canonicalKey,
    exactReference: payload.exactReference,
    relationBacked: payload.relationBacked,
    implementationAvailable: payload.implementationAvailable,
    evidenceBoundary: payload.evidenceBoundary,
    evidenceBoundaryReason: payload.evidenceBoundaryReason,
  }
  if (Array.isArray(payload.records)) sanitized.records = payload.records.map(compactRecord)
  else if (payload.records && Array.isArray(payload.records.items)) {
    sanitized.records = {
      items: payload.records.items.map(compactRecord),
      totalCount: payload.records.totalCount,
      complete: payload.records.complete,
    }
  }
  return sanitized
}

const boundaryEvidence = (items: Array<Record<string, unknown>>) => {
  const names = toolNames(items)
  const evidence: Array<Record<string, unknown>> = []
  let hasBoundary = false
  for (const item of items || []) {
    if (String(item?.type || '') !== 'function_call_output') continue
    const payload: any = parse(item.output)
    const name = names.get(String(item.call_id || '')) || 'knowledge_tool'
    if (payload?.evidenceBoundary === 'metadata_only') hasBoundary = true
    if (
      payload?.evidenceBoundary === 'metadata_only'
      || name === 'get_objects_by_technical_reference'
      || name === 'get_abap_source'
    ) {
      evidence.push({ tool: name, payload: sanitizePayload(payload) })
    }
  }
  return hasBoundary ? evidence : null
}

const conversationItems = (items: Array<Record<string, unknown>>) => (items || [])
  .filter((item: any) => {
    const role = String(item?.role || '')
    const type = String(item?.type || '')
    return (!type && (role === 'user' || role === 'assistant')) || type === 'message'
  })
  .slice(-8)
  .map((item: any) => ({
    role: String(item.role || 'assistant'),
    content: typeof item.content === 'string'
      ? item.content
      : Array.isArray(item.content)
        ? item.content.map((part: any) => part?.text || '').join('\n')
        : '',
  }))
  .filter((item: any) => item.content)

async function synthesizeMetadataBoundary(input: any, evidence: Array<Record<string, unknown>>) {
  return rawRequest({
    ...input,
    instructions: `${input.instructions}\n\n[JETWORK VERIFIED EVIDENCE BOUNDARY - REQUIRED]\nThe runtime has explicitly marked the exact implementation/source as unavailable. Research is finished for this turn. The evidence below has deliberately removed source-code/content fields. Answer only from literal identifiers, titles, summaries and relationships remaining in this metadata. Do not reconstruct code from memory. Do not infer database tables, DDIC types, parameter types, method visibility, default values, return types or variable names, algorithms, MESSAGE statements, or business meanings that are not literally stated. Never label an inferred type or meaning as probable/possible. If the requested implementation detail is absent, state that it cannot be verified from the available source evidence. Relation-only candidates may be named only to distinguish possible technical identities; they are not implementation bodies.`,
    items: [
      ...conversationItems(input.items),
      {
        role: 'user',
        content: `[JETWORK_VERIFIED_METADATA_ONLY_EVIDENCE]\n${JSON.stringify(evidence).slice(0, 18_000)}\n[END_JETWORK_VERIFIED_METADATA_ONLY_EVIDENCE]`,
      },
    ],
    tools: [],
    allowTools: false,
  })
}

export async function requestGeminiResponse(input: any): Promise<NormalizedModelResponse> {
  const boundary = boundaryEvidence(input.items || [])
  if (boundary && input.allowTools) return synthesizeMetadataBoundary(input, boundary)
  return evidenceQualityRequest(input)
}
