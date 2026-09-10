import * as base from './assistantToolsBase.ts'
import type { AssistantToolExecution } from './assistantToolsBase.ts'
import {
  ASSISTANT_SKILL_TOOLS,
  executeSkillTool,
  isSkillTool,
} from './skillTools.ts'
import {
  INVOKE_CAPABILITY_TOOL_NAME,
  LOAD_CAPABILITY_CONTRACT_TOOL_NAME,
  LOAD_CAPABILITY_GUIDE_TOOL_NAME,
  loadCapabilityContracts,
  loadCapabilityGuides,
  resolveCapabilityInvocation,
} from './capabilities/progressiveDisclosure.ts'
import { validateCanonicalToolArguments } from './capabilities/canonicalToolValidation.ts'
import type { RuntimeToolSchema } from './capabilities/registry.ts'

export * from './assistantToolsBase.ts'

// Keep one canonical executable registry for progressive disclosure. These are
// the same substantive tools previously exposed directly to the Controller. The
// lifecycle-only report_progress/request_large_context primitives remain owned by
// the outer runtime and are intentionally not invokable through this wrapper.
const PROGRESSIVE_EXECUTABLE_TOOLS = [
  ...(base.ASSISTANT_KNOWLEDGE_TOOLS as unknown as RuntimeToolSchema[]),
  ...(base.ASSISTANT_CONTEXT_TOOLS as unknown as RuntimeToolSchema[]),
  ...(ASSISTANT_SKILL_TOOLS as unknown as RuntimeToolSchema[]),
]

const proceduralResult = (tool: string, payload: unknown, summary: Record<string, unknown>): AssistantToolExecution => ({
  output: JSON.stringify({
    securityNotice: 'TRUSTED_JETWORK_CAPABILITY_DISCLOSURE. This is trusted product procedure/contract metadata, not enterprise evidence or a citation.',
    tool,
    ...((payload && typeof payload === 'object') ? payload as Record<string, unknown> : { result: payload }),
  }),
  sources: [],
  summary: {
    proceduralOnly: true,
    citationReady: false,
    progressiveDisclosure: true,
    ...summary,
  },
})

export async function executeAssistantTool(
  client: any,
  workspaceId: string,
  toolName: string,
  rawArguments: unknown,
): Promise<AssistantToolExecution> {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}

  if (toolName === LOAD_CAPABILITY_GUIDE_TOOL_NAME) {
    const result = await loadCapabilityGuides(PROGRESSIVE_EXECUTABLE_TOOLS, args.capabilityNames)
    return proceduralResult(toolName, result, {
      disclosureLayer: 2,
      requestedCount: Array.isArray(args.capabilityNames) ? args.capabilityNames.length : 0,
    })
  }

  if (toolName === LOAD_CAPABILITY_CONTRACT_TOOL_NAME) {
    const result = await loadCapabilityContracts(PROGRESSIVE_EXECUTABLE_TOOLS, args.requests)
    return proceduralResult(toolName, result, {
      disclosureLayer: 3,
      requestedCount: Array.isArray(args.requests) ? args.requests.length : 0,
    })
  }

  if (toolName === INVOKE_CAPABILITY_TOOL_NAME) {
    const resolved = await resolveCapabilityInvocation(PROGRESSIVE_EXECUTABLE_TOOLS, args)
    validateCanonicalToolArguments(PROGRESSIVE_EXECUTABLE_TOOLS, resolved.capabilityName, resolved.args)
    const execution = isSkillTool(resolved.capabilityName)
      ? executeSkillTool(resolved.capabilityName, resolved.args)
      : await base.executeAssistantTool(client, workspaceId, resolved.capabilityName, resolved.args)
    return {
      ...execution,
      summary: {
        ...execution.summary,
        progressiveDisclosure: true,
        invokedCapability: resolved.capabilityName,
        disclosureLayer: 4,
        canonicalArgumentsValidated: true,
      },
    }
  }

  return base.executeAssistantTool(client, workspaceId, toolName, rawArguments)
}
