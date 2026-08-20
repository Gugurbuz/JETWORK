import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=2'
import { requestGeminiResponse as baseRequestGeminiResponse } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProvidersBase.ts?exact-quality-base=2'
import { extractSemanticPlanFromItems } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/geminiCostGuard.ts?exact-quality-plan=2'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=2'

const mergeUsage = (base?: Record<string, number>, extra: Record<string, number> = {}) => ({ ...(base || {}), ...extra })
const INLINE_EVIDENCE = /\[UNTRUSTED_EVIDENCE\]([\s\S]*?)\[END_UNTRUSTED_EVIDENCE\]/i

const hasCompletedMessageDetailEvidence = (items: Array<Record<string, unknown>>) => {
  const detailCallIds = new Set<string>()
  for (const item of items) {
    if (String(item.type || '') === 'function_call' && String(item.name || '') === 'get_message_detail') {
      const id = String(item.call_id || '')
      if (id) detailCallIds.add(id)
    }
  }
  if (!detailCallIds.size) return false
  return items.some(item => {
    if (String(item.type || '') !== 'function_call_output') return false
    if (!detailCallIds.has(String(item.call_id || ''))) return false
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
    return Boolean(output && output.length > 40 && !/"resultCount"\s*:\s*0/.test(output))
  })
}

const inlineEvidence = (instructions: string) => String(instructions.match(INLINE_EVIDENCE)?.[1] || '').trim()

const isBoundedExactDetailPlan = (items: Array<Record<string, unknown>>) => {
  const plan = extractSemanticPlanFromItems(items)
  return Boolean(
    plan
    && String(plan.orchestratorVersion || '').includes('quality-recovery-v2')
    && plan.enterpriseGroundingRequired === true
    && plan.steps?.some(step => step.id === 'exact-enterprise-detail')
  )
}

const visibleText = (response: Awaited<ReturnType<typeof baseRequestGeminiResponse>>) => (
  (response.output || [])
    .filter(item => String(item.type || '') === 'message')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .map(part => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
      ? String((part as Record<string, unknown>).text)
      : '')
    .filter(Boolean)
    .join('\n')
    .trim()
)

const sanitizeUnsupportedAcronymExpansions = (text: string, evidence: string) => {
  const evidenceLower = evidence.toLocaleLowerCase('tr-TR')
  let removed = 0
  const sanitized = text.replace(/\b([A-ZÇĞİÖŞÜ][A-Z0-9ÇĞİÖŞÜ_/-]{2,})\s*\(([^)\n]{2,120})\)/gu, (full, acronym: string) => {
    if (evidenceLower.includes(String(full).toLocaleLowerCase('tr-TR'))) return full
    removed += 1
    return acronym
  })
  return { text: sanitized, removed }
}

const rewriteVisibleText = (
  response: Awaited<ReturnType<typeof baseRequestGeminiResponse>>,
  text: string,
) => {
  let replaced = false
  const output = (response.output || []).map(item => {
    if (replaced || String(item.type || '') !== 'message' || !Array.isArray(item.content)) return item
    const content = item.content.map(part => {
      if (replaced || !part || typeof part !== 'object' || typeof (part as Record<string, unknown>).text !== 'string') return part
      replaced = true
      return { ...(part as Record<string, unknown>), text }
    })
    return { ...item, content }
  })
  return { ...response, output }
}

export async function requestGeminiResponse(
  input: Parameters<typeof original.requestGeminiResponse>[0],
): Promise<Awaited<ReturnType<typeof original.requestGeminiResponse>>> {
  const exactPlan = isBoundedExactDetailPlan(input.items)
  const evidence = inlineEvidence(input.instructions)
  const verifiedEvidenceAvailable = hasCompletedMessageDetailEvidence(input.items) || evidence.length > 120
  if (!exactPlan || !verifiedEvidenceAvailable) return original.requestGeminiResponse(input)

  // Exact corporate detail is already resolved by core preflight. Buffer this one
  // synthesis call so unsupported acronym expansions can be removed before any
  // user-visible text is emitted. Other turns preserve normal live streaming.
  let streamed = ''
  const response = await baseRequestGeminiResponse({
    ...input,
    tools: [],
    allowTools: false,
    allowProviderWeb: false,
    onText: delta => { streamed += delta },
  })
  const rawText = visibleText(response) || streamed
  const sanitized = sanitizeUnsupportedAcronymExpansions(rawText, evidence)
  if (sanitized.text) input.onText(sanitized.text)
  const rewritten = sanitized.text && sanitized.text !== rawText
    ? rewriteVisibleText(response, sanitized.text)
    : response
  return {
    ...rewritten,
    usage: mergeUsage(rewritten.usage, {
      quality_exact_detail_single_synthesis: 1,
      quality_redundant_tool_round_avoided: 1,
      quality_unsupported_acronym_expansions_removed: sanitized.removed,
    }),
  }
}
