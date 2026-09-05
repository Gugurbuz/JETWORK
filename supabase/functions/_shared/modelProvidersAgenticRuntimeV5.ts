export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@456122c2ae4e00267f3e47c03d6289ff39ad3771/supabase/functions/_shared/modelProvidersAgenticRuntimeV4.ts?agentic-provider-v5-base=1'
import { requestGeminiResponse as requestGeminiResponseV4 } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@456122c2ae4e00267f3e47c03d6289ff39ad3771/supabase/functions/_shared/modelProvidersAgenticRuntimeV4.ts?agentic-provider-v5-base=1'

const KNOWLEDGE_COMPLETION_MARKER = 'JETWORK_KNOWLEDGE_DEPENDENCY_COMPLETE'
const CONTINUATION_MODEL = 'gemini-3.1-pro-preview'

const outputText = (item: Record<string, unknown>) => (
  String(item.type || '') === 'function_call_output'
    ? (typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''))
    : ''
)

const knowledgeComplete = (items: Array<Record<string, unknown>>) => (
  items.some(item => outputText(item).includes(KNOWLEDGE_COMPLETION_MARKER))
)

const visibleText = (response: any) => (
  (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => item?.type === 'message' && Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim()
)

const functionCalls = (response: any) => (
  (Array.isArray(response?.output) ? response.output : []).filter((item: any) => item?.type === 'function_call')
)

const mergeUsage = (usage: Record<string, number> | undefined, extra: Record<string, number>) => {
  const merged = { ...(usage || {}) }
  for (const [key, value] of Object.entries(extra)) merged[key] = Number(merged[key] || 0) + value
  return merged
}

export async function requestGeminiResponse(input: any): Promise<any> {
  const items = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
  let response = await requestGeminiResponseV4(input)
  if (!knowledgeComplete(items) || visibleText(response) || functionCalls(response).length) return response
  if (String(input.model || '') === CONTINUATION_MODEL) return response

  const recovered = await requestGeminiResponseV4({
    ...input,
    model: CONTINUATION_MODEL,
    instructions: [
      String(input.instructions || ''),
      '[JETWORK CONTROLLER CONTINUATION RECOVERY]',
      'The previous controller model produced no user-visible text and selected no executable capability after verified knowledge completed. Continue from the SAME existing task/evidence state; do not restart research. Re-evaluate the remaining user goal yourself. If a declared execution capability is still required by the user goal, call it with complete arguments. If no execution remains, produce the final user-visible answer. Do not describe internal recovery.',
    ].join('\n\n'),
  })

  return {
    ...recovered,
    usage: mergeUsage(recovered?.usage, {
      controller_blank_continuation_escalation: 1,
      controller_blank_continuation_escalated_to_pro: 1,
    }),
  }
}
