export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3c52565c0d4db326dbc81fc7bd698c67f539fe16/supabase/functions/_shared/modelProvidersAgenticRuntime.ts?agentic-provider-v2-base=1'
import { requestGeminiResponse as baseAgenticRequestGeminiResponse } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3c52565c0d4db326dbc81fc7bd698c67f539fe16/supabase/functions/_shared/modelProvidersAgenticRuntime.ts?agentic-provider-v2-base=1'

const KNOWLEDGE_TOOL_NAME = 'research_knowledge'
const ARTIFACT_BUNDLE_TOOL_NAME = 'create_artifact_bundle'
const KNOWLEDGE_COMPLETION_MARKER = 'JETWORK_KNOWLEDGE_DEPENDENCY_COMPLETE'
const ARTIFACT_COMPLETION_MARKER = 'JETWORK_ARTIFACT_DEPENDENCY_COMPLETE'

const mergeUsage = (...values: Array<Record<string, number> | undefined>) => {
  const merged: Record<string, number> = {}
  for (const value of values) {
    for (const [key, raw] of Object.entries(value || {})) {
      const amount = Number(raw)
      if (Number.isFinite(amount)) merged[key] = (merged[key] || 0) + amount
    }
  }
  return merged
}

const outputText = (item: Record<string, unknown>) => {
  if (String(item.type || '') !== 'function_call_output') return ''
  return typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
}

const hasKnowledgeCompletionMarker = (items: Array<Record<string, unknown>>) => (
  items.some(item => {
    const text = outputText(item)
    return text.includes(KNOWLEDGE_COMPLETION_MARKER)
      || (/"mechanicalCoverageComplete"\s*:\s*true/.test(text)
        && /"citationReady"\s*:\s*true/.test(text))
  })
)

const hasArtifactCompletionMarker = (items: Array<Record<string, unknown>>) => (
  items.some(item => outputText(item).includes(ARTIFACT_COMPLETION_MARKER))
)

const schemaName = (tool: Record<string, unknown>) => {
  if (typeof tool?.name === 'string') return tool.name
  const fn = tool?.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof (fn as Record<string, unknown>).name === 'string') {
    return String((fn as Record<string, unknown>).name)
  }
  return ''
}

export async function requestGeminiResponse(input: any): Promise<any> {
  const items = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
  const knowledgeComplete = hasKnowledgeCompletionMarker(items)
  const artifactComplete = hasArtifactCompletionMarker(items)
  let tools = Array.isArray(input.tools) ? [...input.tools] : []
  const instructions: string[] = [String(input.instructions || '')]

  if (knowledgeComplete) {
    tools = tools.filter((tool: Record<string, unknown>) => schemaName(tool) !== KNOWLEDGE_TOOL_NAME)
    instructions.push(
      '[JETWORK RUNTIME KNOWLEDGE CLOSURE V2]',
      'The high-level knowledge dependency is mechanically complete. research_knowledge is no longer available in this turn. Use the verified shared evidence already in context and continue with reasoning, artifact creation, web, or final synthesis as appropriate.',
    )
  }

  if (artifactComplete) {
    tools = tools.filter((tool: Record<string, unknown>) => schemaName(tool) !== ARTIFACT_BUNDLE_TOOL_NAME)
    instructions.push(
      '[JETWORK RUNTIME ARTIFACT CLOSURE V2]',
      'The artifact bundle is already created and verified. Do not create duplicate files; produce the final user-visible response.',
    )
  }

  const response = await baseAgenticRequestGeminiResponse({
    ...input,
    tools,
    allowTools: Boolean(input.allowTools && tools.length > 0),
    instructions: instructions.filter(Boolean).join('\n\n'),
  })

  return {
    ...response,
    usage: mergeUsage(response?.usage, {
      ...(knowledgeComplete ? { knowledge_output_marker_closure_applied: 1 } : {}),
      ...(artifactComplete ? { artifact_output_marker_closure_applied: 1 } : {}),
    }),
  }
}
