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
      evidence.push({ tool: name, payload })
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
    instructions: `${input.instructions}\n\n[JETWORK VERIFIED EVIDENCE BOUNDARY - REQUIRED]\nThe tool runtime has explicitly marked the available evidence as metadata_only because the exact implementation object/source is unavailable. Stop research now. Answer only from literal facts in the verified evidence below. Do not infer or guess database tables, DDIC types, method visibility, default values, return-variable names, algorithms, MESSAGE statements, source code, or semantic meanings that are not explicitly present. Do not use general SAP knowledge to fill gaps. If the exact detail requested is absent, say that it cannot be verified from the available implementation evidence. Related call sites may be mentioned only as related usage evidence; do not convert them into the missing implementation.`,
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
