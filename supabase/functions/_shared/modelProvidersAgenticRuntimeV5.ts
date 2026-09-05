export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@456122c2ae4e00267f3e47c03d6289ff39ad3771/supabase/functions/_shared/modelProvidersAgenticRuntimeV4.ts?agentic-provider-v5-base=1'
import { requestGeminiResponse as requestGeminiResponseV4 } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@456122c2ae4e00267f3e47c03d6289ff39ad3771/supabase/functions/_shared/modelProvidersAgenticRuntimeV4.ts?agentic-provider-v5-base=1'

const KNOWLEDGE_COMPLETION_MARKER = 'JETWORK_KNOWLEDGE_DEPENDENCY_COMPLETE'
const KNOWLEDGE_TOOL_NAME = 'research_knowledge'
const CONTINUATION_MODEL = 'gemini-3.1-pro-preview'
const MAX_BLANK_CONTINUATION_RECOVERY_ATTEMPTS = 2

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

const schemaName = (tool: Record<string, unknown>) => {
  if (typeof tool?.name === 'string') return tool.name
  const fn = tool?.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn)) return String((fn as Record<string, unknown>).name || '')
  return ''
}

const mergeUsage = (usage: Record<string, number> | undefined, extra: Record<string, number>) => {
  const merged = { ...(usage || {}) }
  for (const [key, value] of Object.entries(extra)) merged[key] = Number(merged[key] || 0) + value
  return merged
}

const withoutCompletedKnowledgeTool = (tools: Array<Record<string, unknown>>) => (
  tools.filter(tool => schemaName(tool) !== KNOWLEDGE_TOOL_NAME)
)

const recentExecutionFailure = (items: Array<Record<string, unknown>>) => (
  [...items].reverse().map(outputText).find(text => /(?:VALIDATION_FAILED|_FAILED|error)/i.test(text)) || ''
)

export async function requestGeminiResponse(input: any): Promise<any> {
  const items = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
  let response = await requestGeminiResponseV4(input)
  if (!knowledgeComplete(items) || visibleText(response) || functionCalls(response).length) return response

  const declaredTools = Array.isArray(input.tools) ? input.tools as Array<Record<string, unknown>> : []
  const remainingTools = withoutCompletedKnowledgeTool(declaredTools)
  const remainingNames = remainingTools.map(schemaName).filter(Boolean)
  const latestFailure = recentExecutionFailure(items)
  let recoveryUsage: Record<string, number> = {}

  for (let attempt = 1; attempt <= MAX_BLANK_CONTINUATION_RECOVERY_ATTEMPTS; attempt += 1) {
    const recovered = await requestGeminiResponseV4({
      ...input,
      model: CONTINUATION_MODEL,
      tools: remainingTools,
      allowTools: remainingTools.length > 0 && input.allowTools !== false,
      instructions: [
        String(input.instructions || ''),
        '[JETWORK CONTROLLER CONTINUATION RECOVERY]',
        'Verified enterprise knowledge is already complete for the current task. research_knowledge is intentionally unavailable in this recovery round because that dependency is complete.',
        `Continue from the SAME task/evidence state using only the remaining declared capabilities: ${remainingNames.join(', ') || 'none'}. Do not restart research.`,
        latestFailure
          ? 'A previous execution capability returned a validation/execution error. Read that function_call_output, correct only the invalid arguments using the already verified evidence, and retry the required execution capability. Never invent replacement enterprise identifiers.'
          : '',
        'Re-evaluate the remaining user goal yourself. If a declared execution capability is still required, call it with complete arguments. If no execution remains, produce the final user-visible answer. Do not describe internal recovery.',
        attempt > 1
          ? 'The previous continuation attempt also produced neither a visible answer nor an executable capability. Resolve the remaining task now instead of returning an empty response.'
          : '',
      ].filter(Boolean).join('\n\n'),
    })

    recoveryUsage = mergeUsage(recoveryUsage, {
      controller_blank_continuation_escalation: 1,
      controller_blank_continuation_escalated_to_pro: 1,
      controller_completed_knowledge_tool_hidden: declaredTools.length - remainingTools.length,
      controller_execution_failure_visible_to_recovery: latestFailure ? 1 : 0,
    }) || {}

    response = {
      ...recovered,
      usage: mergeUsage(recovered?.usage, recoveryUsage),
    }
    if (visibleText(response) || functionCalls(response).length) return response
  }

  return response
}
