export type CapabilityReadiness = 'defined' | 'executable' | 'verified'
export type CapabilityExecutionMode = 'model' | 'provider' | 'knowledge' | 'file' | 'spreadsheet' | 'artifact' | 'connector'

export interface CapabilityRuntimeStatus {
  readiness: CapabilityReadiness
  mode: CapabilityExecutionMode
  executorTools: string[]
  note?: string
}

const MODEL_FAMILIES = new Set([
  'agent', 'reasoning', 'data', 'business-analysis', 'architecture', 'engineering', 'communication', 'quality',
])

const KNOWLEDGE_FAMILIES = new Set(['knowledge', 'sap'])
const PROVIDER_FAMILIES = new Set(['research'])

const VERIFIED_SPREADSHEET = new Set([
  'spreadsheet/inspect',
  'spreadsheet/format-preserve',
  'spreadsheet/quality-check',
  'spreadsheet/jira-sync',
])

const EXECUTABLE_SPREADSHEET = new Set([
  'spreadsheet/schema-detect',
  'spreadsheet/type-inference',
  'spreadsheet/table-join',
])

export const getCapabilityRuntimeStatus = (key: string): CapabilityRuntimeStatus => {
  const family = String(key || '').split('/')[0]
  if (MODEL_FAMILIES.has(family)) {
    return {
      readiness: 'executable',
      mode: 'model',
      executorTools: [],
      note: 'Procedural/model capability; factual claims still require normal evidence tools when applicable.',
    }
  }
  if (KNOWLEDGE_FAMILIES.has(family)) {
    return {
      readiness: 'verified',
      mode: 'knowledge',
      executorTools: ['search_knowledge_catalog', 'get_knowledge_object', 'get_related_objects'],
    }
  }
  if (PROVIDER_FAMILIES.has(family)) {
    return {
      readiness: 'executable',
      mode: 'provider',
      executorTools: ['provider_web_search'],
    }
  }
  if (family === 'files') {
    return {
      readiness: 'executable',
      mode: 'file',
      executorTools: ['list_action_attachments', 'inspect_file_attachment'],
      note: 'Binary edit support depends on the file-specific artifact executor.',
    }
  }
  if (family === 'spreadsheet') {
    if (VERIFIED_SPREADSHEET.has(key)) {
      return {
        readiness: 'verified',
        mode: 'spreadsheet',
        executorTools: ['list_spreadsheet_attachments', 'inspect_spreadsheet_file', 'sync_spreadsheet_with_jira_export'],
      }
    }
    if (EXECUTABLE_SPREADSHEET.has(key)) {
      return {
        readiness: 'executable',
        mode: 'spreadsheet',
        executorTools: ['inspect_spreadsheet_file', 'sync_spreadsheet_with_jira_export'],
        note: 'Current executor is narrower than the generic skill contract.',
      }
    }
    return {
      readiness: 'defined',
      mode: 'spreadsheet',
      executorTools: [],
      note: 'Skill is discoverable; generic spreadsheet mutation executor is required for direct file changes.',
    }
  }
  if (['pdf', 'document', 'presentation', 'image', 'artifact'].includes(family)) {
    return {
      readiness: 'defined',
      mode: 'artifact',
      executorTools: [],
      note: 'Artifact executor wiring is required for direct binary creation or mutation.',
    }
  }
  if (family === 'automation') {
    return {
      readiness: 'defined',
      mode: 'connector',
      executorTools: [],
      note: 'Requires a connected action/scheduling backend before side-effecting execution can be claimed.',
    }
  }
  if (family === 'jira') {
    return {
      readiness: 'executable',
      mode: 'model',
      executorTools: ['spreadsheet/Jira tools when available'],
    }
  }
  return { readiness: 'defined', mode: 'model', executorTools: [] }
}
