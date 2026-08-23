import {
  ASSISTANT_KNOWLEDGE_TOOLS as EVIDENCE_TOOLS,
  executeAssistantTool as evidenceExecuteAssistantTool,
  type AssistantToolExecution,
} from './assistantToolsTechnicalReferenceQuality.ts'
import {
  ASSISTANT_ARTIFACT_TOOLS,
  isArtifactExecutionTool,
} from './artifactExecutionTools.ts'
import { executeArtifactAssistantTool } from './artifactAssistantTool.ts'

export * from './assistantToolsTechnicalReferenceQuality.ts'

// Production maps assistantTools.ts to this authoritative wrapper. Preserve the
// binary artifact surface while adding authoritative evidence behavior; otherwise
// Auto/legacy turns silently lose DOCX/PPTX/PDF/image execution capabilities.
export const ASSISTANT_KNOWLEDGE_TOOLS = [
  ...EVIDENCE_TOOLS,
  ...ASSISTANT_ARTIFACT_TOOLS,
] as const

const AUTHORITATIVE_FIRST_PASS_TOOLS = new Set([
  'get_message_detail',
  'search_knowledge_catalog',
  'get_related_objects',
  'search_document',
  'get_knowledge_object',
  'get_document_content',
  'get_objects_by_technical_reference',
  'resolve_knowledge_evidence',
])

const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)

const resolutionArguments = (toolName: string, rawArguments: unknown) => {
  const args = rawArguments && typeof rawArguments === 'object'
    ? rawArguments as Record<string, unknown>
    : {}
  if (toolName === 'resolve_knowledge_evidence') return rawArguments

  const query = clean(
    args.query
      ?? args.technicalReference
      ?? args.messageCode
      ?? args.canonicalKey,
  )
  return query ? { query } : null
}

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  if (isArtifactExecutionTool(toolName)) {
    const args = rawArguments && typeof rawArguments === 'object'
      ? rawArguments as Record<string, unknown>
      : {}
    return executeArtifactAssistantTool(client, workspaceId, toolName, args)
  }

  if (AUTHORITATIVE_FIRST_PASS_TOOLS.has(toolName)) {
    const resolveArgs = resolutionArguments(toolName, rawArguments)
    if (resolveArgs) {
      try {
        const resolved = await evidenceExecuteAssistantTool(
          client,
          workspaceId,
          'resolve_knowledge_evidence',
          resolveArgs,
        )
        if (resolved.summary?.authoritativeResolution === true) {
          return {
            ...resolved,
            summary: {
              ...resolved.summary,
              terminalAuthoritativeEvidence: true,
              originalRequestedTool: toolName,
            },
          }
        }
      } catch (error) {
        // Authoritative resolution is an optimization, not a gate. A resolver
        // miss or malformed legacy record must never prevent the requested
        // exact/detail tool from running with its native argument contract.
        console.warn('AUTHORITATIVE_EVIDENCE_PREPASS_FAILED', toolName, String(error).slice(0, 300))
      }
    }
  }

  return evidenceExecuteAssistantTool(client, workspaceId, toolName, rawArguments)
}
