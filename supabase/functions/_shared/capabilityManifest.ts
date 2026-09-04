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
  'spreadsheet/cell-value-edit',
  'spreadsheet/data-cleaning',
  'spreadsheet/column-normalization',
  'spreadsheet/filter-sort',
  'spreadsheet/table-join',
  'spreadsheet/deduplicate',
  'spreadsheet/formula',
  'spreadsheet/aggregation',
  'spreadsheet/formatting',
  'spreadsheet/sheet-management',
  'spreadsheet/workbook-create',
  'spreadsheet/workbook-export',
  'spreadsheet/change-report',
])
const SPREADSHEET_TOOLS = [
  'list_spreadsheet_attachments',
  'inspect_spreadsheet_file',
  'edit_spreadsheet_file',
  'transform_spreadsheet_file',
  'create_spreadsheet_file',
  'validate_spreadsheet_file',
  'sync_spreadsheet_with_jira_export',
]

const EXECUTABLE_PDF = new Set(['pdf/inspect', 'pdf/visual-analysis', 'pdf/layout-analysis', 'pdf/summarize', 'pdf/compare', 'pdf/merge', 'pdf/split'])
const EXECUTABLE_DOCUMENT = new Set(['document/inspect', 'document/structure-extract', 'document/summarize', 'document/rewrite', 'document/section-edit', 'document/style-preserve', 'document/generate', 'document/compare'])
const EXECUTABLE_PRESENTATION = new Set(['presentation/inspect', 'presentation/structure-analysis', 'presentation/storytelling', 'presentation/slide-generation', 'presentation/slide-edit', 'presentation/layout', 'presentation/theme-preserve', 'presentation/quality-check'])
const EXECUTABLE_IMAGE = new Set(['image/inspect', 'image/visual-understanding', 'image/screenshot-analysis', 'image/ui-analysis', 'image/diagram-understanding', 'image/chart-understanding', 'image/table-understanding', 'image/compare-images', 'image/generate', 'image/edit'])
const ARTIFACT_TOOLS = ['list_action_attachments', 'inspect_file_attachment', 'transform_pdf_file', 'edit_office_file', 'create_document_file', 'generate_or_edit_image']

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
      executorTools: ['search_knowledge_catalog', 'list_knowledge_catalog', 'get_knowledge_object', 'get_knowledge_objects', 'get_related_objects'],
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
      note: 'General file discovery/inspection is executable; mutation depends on the file-specific artifact capability.',
    }
  }
  if (family === 'spreadsheet') {
    if (VERIFIED_SPREADSHEET.has(key)) return { readiness: 'verified', mode: 'spreadsheet', executorTools: SPREADSHEET_TOOLS }
    if (EXECUTABLE_SPREADSHEET.has(key)) return { readiness: 'executable', mode: 'spreadsheet', executorTools: SPREADSHEET_TOOLS }
    return {
      readiness: 'defined', mode: 'spreadsheet', executorTools: [],
      note: 'Skill is discoverable but the current allow-listed workbook executor does not implement this operation yet.',
    }
  }
  if (family === 'pdf') {
    return EXECUTABLE_PDF.has(key)
      ? { readiness: 'executable', mode: 'artifact', executorTools: ARTIFACT_TOOLS }
      : { readiness: 'defined', mode: 'artifact', executorTools: [], note: 'PDF skill is defined; current binary executor does not implement this mutation yet.' }
  }
  if (family === 'document') {
    return EXECUTABLE_DOCUMENT.has(key)
      ? { readiness: 'executable', mode: 'artifact', executorTools: ARTIFACT_TOOLS, note: key === 'document/style-preserve' ? 'Existing OOXML package is preserved for exact text edits; complex layout redesign is not claimed.' : undefined }
      : { readiness: 'defined', mode: 'artifact', executorTools: [], note: 'Document skill is defined; current DOCX executor does not implement this mutation yet.' }
  }
  if (family === 'presentation') {
    return EXECUTABLE_PRESENTATION.has(key)
      ? { readiness: 'executable', mode: 'artifact', executorTools: ARTIFACT_TOOLS, note: ['presentation/layout','presentation/theme-preserve'].includes(key) ? 'Generation has deterministic layout; arbitrary existing-deck redesign is intentionally not claimed.' : undefined }
      : { readiness: 'defined', mode: 'artifact', executorTools: [], note: 'Presentation skill is defined; current PPTX executor does not implement this mutation yet.' }
  }
  if (family === 'image') {
    return EXECUTABLE_IMAGE.has(key)
      ? { readiness: 'executable', mode: 'artifact', executorTools: ARTIFACT_TOOLS }
      : { readiness: 'defined', mode: 'artifact', executorTools: [], note: 'Image skill is defined; no dedicated deterministic executor is wired for this operation yet.' }
  }
  if (family === 'artifact') {
    const executable = new Set(['artifact/create-file','artifact/edit-existing-file','artifact/attach-output','artifact/secure-download','artifact/validate-output','artifact/choose-output-format'])
    return executable.has(key)
      ? { readiness: 'executable', mode: 'artifact', executorTools: ARTIFACT_TOOLS }
      : { readiness: 'defined', mode: 'artifact', executorTools: [] }
  }
  if (family === 'automation') {
    return {
      readiness: 'defined', mode: 'connector', executorTools: [],
      note: 'Scheduling/action semantics are defined but require an explicitly connected action backend before side effects can be claimed.',
    }
  }
  if (family === 'jira') {
    return {
      readiness: 'executable',
      mode: 'model',
      executorTools: ['spreadsheet and knowledge tools when applicable'],
      note: 'Jira export analysis is executable from attached data; direct Jira write actions require a connected Jira action tool.',
    }
  }
  return { readiness: 'defined', mode: 'model', executorTools: [] }
}
