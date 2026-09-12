export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@212b100fceb08e2890ddabe13a18aaefacf3d2ab/supabase/functions/_shared/modelProvidersAgenticRuntimeV3.ts?agentic-provider-v4-base=1'
import { requestGeminiResponse as requestGeminiResponseV3 } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@212b100fceb08e2890ddabe13a18aaefacf3d2ab/supabase/functions/_shared/modelProvidersAgenticRuntimeV3.ts?agentic-provider-v4-base=1'

const KNOWLEDGE_TOOL_NAME = 'research_knowledge'
const ARTIFACT_BUNDLE_TOOL_NAME = 'create_artifact_bundle'
const KNOWLEDGE_COMPLETION_MARKER = 'JETWORK_KNOWLEDGE_DEPENDENCY_COMPLETE'
const ARTIFACT_COMPLETION_MARKER = 'JETWORK_ARTIFACT_DEPENDENCY_COMPLETE'

const outputText = (item: Record<string, unknown>) => (
  String(item.type || '') === 'function_call_output'
    ? (typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''))
    : ''
)

const hasMarker = (items: Array<Record<string, unknown>>, marker: string) => (
  items.some(item => outputText(item).includes(marker))
)

const schemaName = (tool: Record<string, unknown>) => {
  if (typeof tool?.name === 'string') return tool.name
  const fn = tool?.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn)) return String((fn as Record<string, unknown>).name || '')
  return ''
}

const responseText = (response: any) => (
  (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => item?.type === 'message' && Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim()
)

const mergeUsage = (usage: Record<string, number> | undefined, extra: Record<string, number>) => {
  const merged = { ...(usage || {}) }
  for (const [key, value] of Object.entries(extra)) merged[key] = Number(merged[key] || 0) + value
  return merged
}

const staleCompletedDependencyCalls = (response: any, inputItems: Array<Record<string, unknown>>) => {
  const knowledgeComplete = hasMarker(inputItems, KNOWLEDGE_COMPLETION_MARKER)
  const artifactComplete = hasMarker(inputItems, ARTIFACT_COMPLETION_MARKER)
  const stale = new Set<string>()
  if (knowledgeComplete) stale.add(KNOWLEDGE_TOOL_NAME)
  if (artifactComplete) stale.add(ARTIFACT_BUNDLE_TOOL_NAME)
  if (!stale.size) return { response, removed: 0, removedNames: [] as string[] }

  const output = Array.isArray(response?.output) ? response.output as Array<Record<string, unknown>> : []
  const removedNames: string[] = []
  const filtered = output.filter(item => {
    if (String(item.type || '') !== 'function_call') return true
    const name = String(item.name || '')
    if (!stale.has(name)) return true
    removedNames.push(name)
    return false
  })
  if (!removedNames.length) return { response, removed: 0, removedNames }
  return {
    response: {
      ...response,
      output: filtered,
      usage: mergeUsage(response?.usage, { stale_completed_dependency_calls_removed: removedNames.length }),
    },
    removed: removedNames.length,
    removedNames,
  }
}

export async function requestGeminiResponse(input: any): Promise<any> {
  const inputItems = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
  const declaredTools = Array.isArray(input.tools) ? input.tools as Array<Record<string, unknown>> : []
  const declaredNames = new Set(declaredTools.map(schemaName).filter(Boolean))
  let response = await requestGeminiResponseV3(input)

  for (let recovery = 0; recovery < 2; recovery += 1) {
    const cleaned = staleCompletedDependencyCalls(response, inputItems)
    response = cleaned.response
    if (!cleaned.removed) return response

    const remainingFunctionCalls = (Array.isArray(response?.output) ? response.output : [])
      .filter((item: any) => item?.type === 'function_call')
    if (remainingFunctionCalls.length || responseText(response)) return response

    const retryTools = declaredTools.filter(tool => !cleaned.removedNames.includes(schemaName(tool)))
    response = await requestGeminiResponseV3({
      ...input,
      tools: retryTools,
      allowTools: retryTools.length > 0 && input.allowTools !== false,
      instructions: [
        String(input.instructions || ''),
        '[JETWORK STALE TOOL CALL RECOVERY]',
        `The previous provider attempt requested completed or unavailable dependencies (${cleaned.removedNames.join(', ')}). Those calls were mechanically rejected because they are no longer declared for this round. Re-evaluate the remaining user goal using only currently declared capabilities: ${[...declaredNames].filter(name => !cleaned.removedNames.includes(name)).join(', ')}. Do not repeat a completed dependency.`,
      ].join('\n\n'),
    })
    response = {
      ...response,
      usage: mergeUsage(response?.usage, { stale_dependency_recovery_attempts: 1 }),
    }
  }

  return staleCompletedDependencyCalls(response, inputItems).response
}
