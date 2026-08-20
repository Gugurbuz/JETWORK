import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=1'
import { requestGeminiResponse as baseRequestGeminiResponse } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProvidersBase.ts?exact-quality-base=1'
import { extractSemanticPlanFromItems } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/geminiCostGuard.ts?exact-quality-plan=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/1c6b0f056c82f1ff5af7971e652ee3a57aaab80b/supabase/functions/_shared/modelProviders.ts?exact-quality-base=1'

const mergeUsage = (base?: Record<string, number>, extra: Record<string, number> = {}) => ({ ...(base || {}), ...extra })

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

const isBoundedExactDetailPlan = (items: Array<Record<string, unknown>>) => {
  const plan = extractSemanticPlanFromItems(items)
  return Boolean(
    plan
    && String(plan.orchestratorVersion || '').includes('quality-recovery-v2')
    && plan.enterpriseGroundingRequired === true
    && plan.steps?.some(step => step.id === 'exact-enterprise-detail')
  )
}

export async function requestGeminiResponse(
  input: Parameters<typeof original.requestGeminiResponse>[0],
): Promise<Awaited<ReturnType<typeof original.requestGeminiResponse>>> {
  if (!isBoundedExactDetailPlan(input.items) || !hasCompletedMessageDetailEvidence(input.items)) {
    return original.requestGeminiResponse(input)
  }

  // Core preflight has already produced authoritative exact-detail evidence.
  // Synthesize once from that evidence; do not let the model re-call the same
  // knowledge capability and pay a second provider round-trip.
  const response = await baseRequestGeminiResponse({
    ...input,
    tools: [],
    allowTools: false,
    allowProviderWeb: false,
  })
  return {
    ...response,
    usage: mergeUsage(response.usage, {
      quality_exact_detail_single_synthesis: 1,
      quality_redundant_tool_round_avoided: 1,
    }),
  }
}
