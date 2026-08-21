declare module 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/38177ae051973d5d318e3bd37e94f6fc3879041b/supabase/functions/_shared/assistantTools.ts?technical-reference-quality=1' {
  export interface AssistantSourceRef {
    sourceId?: string
    sourceName: string
    canonicalKey?: string
    objectType?: string
    title?: string
  }

  export interface AssistantToolExecution {
    output: string
    sources: AssistantSourceRef[]
    summary?: Record<string, unknown>
  }

  export const ASSISTANT_KNOWLEDGE_TOOLS: readonly unknown[]

  export function executeAssistantTool(
    client: any,
    workspaceId: string,
    toolName: string,
    rawArguments: unknown,
  ): Promise<AssistantToolExecution>
}
