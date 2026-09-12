import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
  executeAssistantTool as executeAgenticRuntimeV3,
  type AssistantSourceRef,
  type AssistantToolExecution,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@3c52565c0d4db326dbc81fc7bd698c67f539fe16/supabase/functions/_shared/assistantToolsAgenticRuntimeV3.ts?knowledge-runtime-v4-base=1'

export {
  ASSISTANT_KNOWLEDGE_TOOLS,
  ARTIFACT_BUNDLE_TOOL,
  ARTIFACT_BUNDLE_TOOL_NAME,
  HIGH_LEVEL_KNOWLEDGE_TOOL,
  HIGH_LEVEL_KNOWLEDGE_TOOL_NAME,
}
export type { AssistantSourceRef, AssistantToolExecution }

export const KNOWLEDGE_RUNTIME_VERSION = 'knowledge-runtime-v4'
export const KNOWLEDGE_COMPLETION_MARKER = 'JETWORK_KNOWLEDGE_DEPENDENCY_COMPLETE'
export const ARTIFACT_COMPLETION_MARKER = 'JETWORK_ARTIFACT_DEPENDENCY_COMPLETE'

const CACHE_TTL_MS = 10 * 60 * 1000
const completedKnowledge = new Map<string, { at: number; execution: AssistantToolExecution }>()

const parseJson = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const pruneCache = () => {
  const now = Date.now()
  for (const [key, value] of completedKnowledge) {
    if (now - value.at > CACHE_TTL_MS) completedKnowledge.delete(key)
  }
}

const markKnowledgeComplete = (execution: AssistantToolExecution, duplicateResearchSuppressed = false): AssistantToolExecution => {
  const parsed = parseJson(execution.output)
  const records = parsed.records && typeof parsed.records === 'object' && !Array.isArray(parsed.records)
    ? parsed.records as Record<string, unknown>
    : {}
  const marked = {
    ...parsed,
    completionMarker: KNOWLEDGE_COMPLETION_MARKER,
    dependencyState: 'complete',
    records: {
      ...records,
      mechanicalCoverageComplete: true,
      duplicateResearchSuppressed,
    },
  }
  return {
    ...execution,
    output: JSON.stringify(marked),
    summary: {
      ...execution.summary,
      knowledgeRuntimeVersion: KNOWLEDGE_RUNTIME_VERSION,
      mechanicalCoverageComplete: true,
      dependencyState: 'complete',
      completionMarker: KNOWLEDGE_COMPLETION_MARKER,
      duplicateResearchSuppressed,
    },
  }
}

const markArtifactComplete = (execution: AssistantToolExecution): AssistantToolExecution => {
  if (!Array.isArray(execution.artifacts) || execution.artifacts.length < 1) return execution
  const parsed = parseJson(execution.output)
  return {
    ...execution,
    output: JSON.stringify({
      ...parsed,
      completionMarker: ARTIFACT_COMPLETION_MARKER,
      dependencyState: 'complete',
    }),
    summary: {
      ...execution.summary,
      completionMarker: ARTIFACT_COMPLETION_MARKER,
      dependencyState: 'complete',
    },
  }
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  pruneCache()

  if (toolName === HIGH_LEVEL_KNOWLEDGE_TOOL_NAME) {
    const cached = completedKnowledge.get(workspaceId)
    if (cached) {
      return markKnowledgeComplete(cached.execution, true)
    }

    const execution = await executeAgenticRuntimeV3(client, workspaceId, toolName, rawArguments)
    if (execution.summary?.mechanicalCoverageComplete === true) {
      const marked = markKnowledgeComplete(execution, false)
      completedKnowledge.set(workspaceId, { at: Date.now(), execution: marked })
      return marked
    }
    return execution
  }

  const execution = await executeAgenticRuntimeV3(client, workspaceId, toolName, rawArguments)
  return toolName === ARTIFACT_BUNDLE_TOOL_NAME ? markArtifactComplete(execution) : execution
}
