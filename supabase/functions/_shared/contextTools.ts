export const CONTEXT_TOOL_VERSION = 'context-tools-v2'

export const RECORD_PROJECT_MEMORY_TOOL_NAME = 'record_project_memory'

export const ASSISTANT_CONTEXT_TOOLS = [
  {
    type: 'function',
    name: RECORD_PROJECT_MEMORY_TOOL_NAME,
    description: 'Persist one durable user-owned project decision or project fact only when the current user message explicitly states it. Provide an exact quote copied from the current user message as provenance. Never use this for assistant hypotheses, inferred facts, transient instructions, or verified technical evidence from tools.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        memoryClass: { type: 'string', enum: ['DECISION', 'PROJECT_FACT', 'CORRECTION'] },
        memoryKey: { type: 'string', minLength: 1, maxLength: 240 },
        value: { type: 'string', minLength: 1, maxLength: 2_000 },
        correctionTarget: { type: ['string', 'null'], enum: ['decision', 'project_fact', null] },
        sourceQuote: { type: 'string', minLength: 2, maxLength: 1_200 },
      },
      required: ['memoryClass', 'memoryKey', 'value', 'correctionTarget', 'sourceQuote'],
      additionalProperties: false,
    },
  },
] as const

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export interface ContextToolExecution {
  output: string
  sources: []
  summary: Record<string, unknown>
}

export const isContextTool = (toolName: string) => ASSISTANT_CONTEXT_TOOLS.some(tool => tool.name === toolName)

export async function executeContextTool(input: {
  client: any
  toolName: string
  args: Record<string, unknown>
  workspaceId: string
  ownerId: string
  sourceMessageId: string
  currentUserText: string
}): Promise<ContextToolExecution> {
  if (input.toolName !== RECORD_PROJECT_MEMORY_TOOL_NAME) throw new Error(`Unknown context tool: ${input.toolName}`)

  const memoryClass = clean(input.args.memoryClass, 40)
  const memoryKey = clean(input.args.memoryKey, 240)
  const value = clean(input.args.value, 2_000)
  const sourceQuote = clean(input.args.sourceQuote, 1_200)
  const correctionTarget = input.args.correctionTarget === null ? null : clean(input.args.correctionTarget, 40)
  const currentUserText = String(input.currentUserText || '')

  if (!['DECISION', 'PROJECT_FACT', 'CORRECTION'].includes(memoryClass)) throw new Error('Unsupported durable memory class.')
  if (!memoryKey || !value || sourceQuote.length < 2) throw new Error('memoryKey, value and sourceQuote are required.')
  if (!currentUserText.includes(sourceQuote)) throw new Error('MEMORY_SOURCE_QUOTE_NOT_IN_CURRENT_USER_MESSAGE')

  let category: 'fact' | 'decision'
  if (memoryClass === 'DECISION') {
    if (correctionTarget !== null) throw new Error('DECISION must not include correctionTarget.')
    category = 'decision'
  } else if (memoryClass === 'PROJECT_FACT') {
    if (correctionTarget !== null) throw new Error('PROJECT_FACT must not include correctionTarget.')
    category = 'fact'
  } else {
    if (!['decision', 'project_fact'].includes(String(correctionTarget || ''))) {
      throw new Error('CORRECTION requires decision or project_fact correctionTarget.')
    }
    category = correctionTarget === 'decision' ? 'decision' : 'fact'
  }

  const { data, error } = await input.client.rpc('persist_agent_project_memory_from_user_quote_v2', {
    p_workspace_id: input.workspaceId,
    p_owner_id: input.ownerId,
    p_source_message_id: input.sourceMessageId,
    p_source_quote: sourceQuote,
    p_memory_key: memoryKey,
    p_value: value,
    p_category: category,
    p_valid_from: new Date().toISOString(),
  })
  if (error) throw new Error(clean(error.message, 1_000) || 'Project Memory persistence failed.')

  return {
    output: JSON.stringify({
      tool: RECORD_PROJECT_MEMORY_TOOL_NAME,
      stored: true,
      memoryId: clean(data, 200),
      memoryClass,
      memoryKey,
      category,
      provenance: 'exact_current_user_quote',
    }),
    sources: [],
    summary: {
      contextOnly: true,
      citationReady: false,
      durableMemoryWrite: true,
      memoryClass,
      category,
      provenanceVerifiedByRuntime: true,
      provenanceVerifiedByDatabase: true,
    },
  }
}
