import * as guarded from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/modelProviders.ts?quality-original=1'
import { requestGeminiResponse as baseRequestGeminiResponse } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/modelProvidersBase.ts?quality-base=1'
import { extractSemanticPlanFromItems } from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/geminiCostGuard.ts?quality-plan=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/a9c7d6f7eb9f670e8c6333b96eed5388a98c1ced/supabase/functions/_shared/modelProviders.ts?quality-original=1'

const mergeNumericUsage = (...values: Array<Record<string, number> | undefined>) => {
  const merged: Record<string, number> = {}
  for (const value of values) {
    for (const [key, raw] of Object.entries(value || {})) {
      const amount = Number(raw)
      if (Number.isFinite(amount)) merged[key] = (merged[key] || 0) + amount
    }
  }
  return merged
}

export async function requestGeminiResponse(
  input: Parameters<typeof guarded.requestGeminiResponse>[0],
): Promise<Awaited<ReturnType<typeof guarded.requestGeminiResponse>>> {
  const plan = extractSemanticPlanFromItems(input.items)
  const enterpriseGrounded = Boolean(plan?.knowledgeRequired && plan?.enterpriseGroundingRequired === true)

  if (!enterpriseGrounded) return guarded.requestGeminiResponse(input)

  const response = await baseRequestGeminiResponse(input)
  return {
    ...response,
    usage: mergeNumericUsage(response.usage, {
      quality_recovery_enterprise_stream_guard_bypassed: 1,
    }),
  }
}
