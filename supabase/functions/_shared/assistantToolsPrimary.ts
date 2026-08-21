import * as original from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/assistantTools.ts?primary-agent-tools=1'

export type {
  AssistantSourceRef,
  AssistantToolExecution,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/assistantTools.ts?primary-agent-tool-types=1'

export const executeAssistantTool = original.executeAssistantTool

const descriptionFor = (tool: Record<string, unknown>) => {
  const name = String(tool.name || '')
  if (name === 'search_knowledge_catalog') {
    return 'Search published JetWork global knowledge plus the active project knowledge when internal context may help answer the user. Preserve the user\'s requested scope. Search results are candidates; read an exact/detail object before presenting a candidate as verified evidence.'
  }
  if (name === 'get_related_objects') {
    return 'Read known relationships for one published knowledge object. Prefer this after locating the object when the user asks what it emits, calls, uses, contains, triggers, produces, depends on, or is otherwise related to.'
  }
  if (name === 'list_knowledge_catalog') {
    return 'Enumerate the knowledge catalog itself. Use only when the user actually wants an inventory, count, exhaustive catalog, or all objects matching an explicit catalog scope. Do not substitute this for a question about one named object or its relationships.'
  }
  if (name === 'get_message_detail') {
    return 'Read the verified published detail for one CRM or ABAP message when a specific message record is relevant.'
  }
  if (name === 'get_knowledge_object') {
    return 'Read the verified published content for one selected knowledge object after discovery or when its canonical key is already known.'
  }
  return String(tool.description || '')
}

export const ASSISTANT_KNOWLEDGE_TOOLS = original.ASSISTANT_KNOWLEDGE_TOOLS.map(tool => ({
  ...tool,
  description: descriptionFor(tool as unknown as Record<string, unknown>),
}))
