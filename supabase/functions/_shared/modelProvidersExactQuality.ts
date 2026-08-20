import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=3'
import { extractSemanticPlanFromItems } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/geminiCostGuard.ts?exact-quality-plan=3'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=3'

const INLINE_EVIDENCE = /\[UNTRUSTED_EVIDENCE\]([\s\S]*?)\[END_UNTRUSTED_EVIDENCE\]/i
const mergeUsage = (base?: Record<string, number>, extra: Record<string, number> = {}) => ({ ...(base || {}), ...extra })

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

const createSentenceGuard = (input: { evidence: string; onText: (text: string) => void }) => {
  let pending = ''
  let emitted = ''
  let removed = 0
  const flush = (force = false) => {
    if (!pending) return
    let cutoff = force ? pending.length : 0
    if (!force) {
      const matches = [...pending.matchAll(/(?:\r?\n|[.!?;:](?:\s+|$))/gu)]
      const last = matches.at(-1)
      if (last) cutoff = Number(last.index || 0) + last[0].length
      if (!cutoff && pending.length > 600) cutoff = Math.max(0, pending.length - 180)
    }
    if (!cutoff) return
    const chunk = pending.slice(0, cutoff)
    pending = pending.slice(cutoff)
    const sanitized = sanitizeUnsupportedAcronymExpansions(chunk, input.evidence)
    removed += sanitized.removed
    emitted += sanitized.text
    input.onText(sanitized.text)
  }
  return {
    push(delta: string) { pending += delta; flush(false) },
    finish() { flush(true) },
    text() { return emitted },
    removed() { return removed },
  }
}

const responseText = (response: Awaited<ReturnType<typeof original.requestGeminiResponse>>) => (
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

const rewriteResponseText = (
  response: Awaited<ReturnType<typeof original.requestGeminiResponse>>,
  text: string,
) => {
  let replaced = false
  const output = (response.output || []).map(item => {
    if (replaced || String(item.type || '') !== 'message' || !Array.isArray(item.content)) return item
    return {
      ...item,
      content: item.content.map(part => {
        if (replaced || !part || typeof part !== 'object' || typeof (part as Record<string, unknown>).text !== 'string') return part
        replaced = true
        return { ...(part as Record<string, unknown>), text }
      }),
    }
  })
  return { ...response, output }
}

export async function requestGeminiResponse(
  input: Parameters<typeof original.requestGeminiResponse>[0],
): Promise<Awaited<ReturnType<typeof original.requestGeminiResponse>>> {
  if (!isBoundedExactDetailPlan(input.items)) return original.requestGeminiResponse(input)

  const evidence = inlineEvidence(input.instructions)
  const guard = createSentenceGuard({ evidence, onText: input.onText })
  const response = await original.requestGeminiResponse({
    ...input,
    onText: delta => guard.push(delta),
  })
  guard.finish()

  const raw = responseText(response)
  const sanitizedComplete = sanitizeUnsupportedAcronymExpansions(raw, evidence).text
  const rewritten = sanitizedComplete && sanitizedComplete !== raw
    ? rewriteResponseText(response, sanitizedComplete)
    : response

  return {
    ...rewritten,
    usage: mergeUsage(rewritten.usage, {
      quality_exact_detail_stream_guard: 1,
      quality_unsupported_acronym_expansions_removed: guard.removed(),
    }),
  }
}
