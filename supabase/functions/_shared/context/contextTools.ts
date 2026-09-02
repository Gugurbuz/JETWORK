export const CONTEXT_TOOLS_VERSION = 'agent-context-tools-v2'

export const ASSISTANT_CONTEXT_TOOLS = [
  {
    type: 'function',
    name: 'record_project_memory',
    description: 'Persist one durable user-owned project fact, decision, or correction when it will materially help future turns. Use only for facts/decisions the user actually stated. sourceQuote must be an exact quote copied from a real user message in this workspace; the database verifies it. Never use this for assistant hypotheses, inferred technical facts, temporary progress, secrets, or evidence retrieved from tools. The runtime/database derives owner and source message identity; you cannot provide them.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        memoryClass: { type: 'string', enum: ['DECISION', 'PROJECT_FACT', 'CORRECTION'] },
        category: { type: 'string', enum: ['decision', 'fact'] },
        memoryKey: { type: 'string', minLength: 1, maxLength: 240 },
        value: { type: 'string', minLength: 1, maxLength: 2_000 },
        sourceQuote: { type: 'string', minLength: 4, maxLength: 1_000 },
      },
      required: ['memoryClass', 'category', 'memoryKey', 'value', 'sourceQuote'],
      additionalProperties: false,
    },
  },
] as const

const TOOL_NAMES = new Set(ASSISTANT_CONTEXT_TOOLS.map(tool => tool.name))
export const isContextTool = (toolName: string) => TOOL_NAMES.has(toolName as never)
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

export interface ContextToolExecution {
  output: string
  sources: []
  summary: Record<string, unknown>
}

export async function executeContextTool(input: {
  client: any
  workspaceId: string
  toolName: string
  args: Record<string, unknown>
}): Promise<ContextToolExecution> {
  if (!isContextTool(input.toolName)) throw new Error(`Unknown context tool: ${input.toolName}`)

  const memoryClass = clean(input.args.memoryClass, 40).toUpperCase()
  const category = clean(input.args.category, 20).toLowerCase()
  const memoryKey = clean(input.args.memoryKey, 240)
  const value = clean(input.args.value, 2_000)
  const sourceQuote = clean(input.args.sourceQuote, 1_000)

  if (!['DECISION', 'PROJECT_FACT', 'CORRECTION'].includes(memoryClass)) throw new Error('Invalid durable memory class.')
  if (!['decision', 'fact'].includes(category)) throw new Error('Invalid durable memory category.')
  if (!memoryKey || !value || sourceQuote.length < 4) throw new Error('memoryKey, value and an exact sourceQuote are required.')

  const { data, error } = await input.client.rpc('record_agent_project_memory_v2', {
    p_workspace_id: input.workspaceId,
    p_memory_key: memoryKey,
    p_value: value,
    p_memory_class: memoryClass,
    p_category: category,
    p_source_quote: sourceQuote,
  })
  if (error) throw new Error(clean(error.message, 1_000) || 'Project Memory write failed.')

  const memoryId = clean(data, 200)
  return {
    output: JSON.stringify({
      securityNotice: 'JETWORK_CONTEXT_WRITE_RESULT. This is a persistence result, not enterprise evidence or a citation.',
      tool: input.toolName,
      saved: Boolean(memoryId),
      memoryId: memoryId || null,
      memoryKey,
      memoryClass,
      category,
    }),
    sources: [],
    summary: {
      contextWrite: true,
      durableMemory: true,
      citationReady: false,
      userProvenanceRequired: true,
      memoryId: memoryId || null,
      memoryKey,
      memoryClass,
      category,
    },
  }
}
