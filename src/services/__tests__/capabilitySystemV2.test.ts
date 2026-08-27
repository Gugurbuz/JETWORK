import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_SKILL_TOOLS,
  JETWORK_RUNTIME_SKILLS,
  listCapabilities,
  loadSkills,
  searchSkills,
} from '../../../supabase/functions/_shared/skillTools.ts'
import {
  JETWORK_V2_FAMILY_COUNTS,
  JETWORK_V2_SKILL_COUNT,
} from '../../../supabase/functions/_shared/skillRegistry.v2.ts'
import { getCapabilityRuntimeStatus } from '../../../supabase/functions/_shared/capabilityManifest.ts'

const artifactWorkerSource = readFileSync(
  new URL('../../../supabase/functions/artifact-execute/index.ts', import.meta.url),
  'utf8',
)
const spreadsheetWorkerSource = readFileSync(
  new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url),
  'utf8',
)
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const chatPanelSource = readFileSync(
  new URL('../../components/ChatPanel.tsx', import.meta.url),
  'utf8',
)
const fileRepositorySource = readFileSync(
  new URL('../assistantFileRepository.ts', import.meta.url),
  'utf8',
)
const liveProxySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-live-proxy/index.ts', import.meta.url),
  'utf8',
)

describe('JetWork Capability System v2', () => {
  it('ships one 20-family / 242-skill master capability catalog', () => {
    expect(Object.keys(JETWORK_V2_FAMILY_COUNTS)).toHaveLength(20)
    expect(JETWORK_V2_SKILL_COUNT).toBe(242)
    expect(Object.values(JETWORK_V2_FAMILY_COUNTS).reduce((sum, count) => sum + Number(count), 0)).toBe(242)
    expect(new Set(JETWORK_RUNTIME_SKILLS.map(skill => skill.key)).size).toBe(JETWORK_RUNTIME_SKILLS.length)
  })

  it('keeps curated legacy skill instructions as richer overrides', () => {
    const [inspect] = loadSkills(['spreadsheet/inspect'])
    expect(inspect).toBeTruthy()
    expect('content' in inspect && inspect.content).toContain('E-tablo üzerinde işlem yapmadan önce gerçek workbook yapısını')
  })

  it('discovers natural-language spreadsheet formatting requests', () => {
    const records = searchSkills({ query: 'tüm satırları kırmızıya boya', category: 'spreadsheet', limit: 8 })
    expect(records.some(record => record.key === 'spreadsheet/formatting')).toBe(true)
    const formatting = records.find(record => record.key === 'spreadsheet/formatting')
    expect(formatting?.readiness).toBe('executable')
    expect(formatting?.executorTools).toContain('edit_spreadsheet_file')
  })

  it('keeps defined/executable/verified separate instead of overclaiming capability', () => {
    expect(getCapabilityRuntimeStatus('spreadsheet/jira-sync').readiness).toBe('verified')
    expect(getCapabilityRuntimeStatus('spreadsheet/formatting').readiness).toBe('executable')
    expect(getCapabilityRuntimeStatus('spreadsheet/pivot').readiness).toBe('defined')
    expect(getCapabilityRuntimeStatus('pdf/merge').readiness).toBe('executable')
    expect(getCapabilityRuntimeStatus('automation/workflow-trigger').readiness).toBe('defined')
  })

  it('exposes readiness-aware self-discovery and all master executors', () => {
    const toolNames = ASSISTANT_SKILL_TOOLS.map(tool => tool.name)
    expect(toolNames).toEqual(expect.arrayContaining([
      'search_skills',
      'load_skills',
      'list_capabilities',
      'edit_spreadsheet_file',
      'transform_spreadsheet_file',
      'create_spreadsheet_file',
      'validate_spreadsheet_file',
      'list_action_attachments',
      'inspect_file_attachment',
      'transform_pdf_file',
      'edit_office_file',
      'create_document_file',
      'generate_or_edit_image',
    ]))
    const page = listCapabilities({ category: 'spreadsheet', readiness: null, cursor: 0, limit: 50 })
    expect(page.totalCount).toBeGreaterThanOrEqual(24)
    expect(page.items.every(item => ['defined', 'executable', 'verified'].includes(item.readiness))).toBe(true)
  })

  it('routes multi-format action files and renders compact secure artifact cards', () => {
    expect(fileRepositorySource).toContain("export const PDF_MIME = 'application/pdf'")
    expect(fileRepositorySource).toContain('DOCX_MIME')
    expect(fileRepositorySource).toContain('PPTX_MIME')
    expect(fileRepositorySource).toContain('isActionableExecutionAttachment')
    expect(liveProxySource).toContain('isActionToolInput')
    expect(chatPanelSource).toContain("'Görev dosyası'")
    expect(chatPanelSource).toContain("'Hazır'")
    expect(chatPanelSource).toContain("att.purpose === 'tool_output' && att.storagePath")
    expect(chatPanelSource).toContain("toUpperCase()} Çıktısı")
  })

  it('implements allow-listed spreadsheet and artifact workers without dynamic code execution', () => {
    expect(spreadsheetWorkerSource).toContain("SUPPORTED_OPERATIONS = new Set(['inspect', 'edit', 'transform', 'create', 'validate', 'jira_sync'])")
    expect(spreadsheetWorkerSource).toContain("operation === 'set_fill'")
    expect(spreadsheetWorkerSource).toContain('setCellBackgroundColor')
    expect(spreadsheetWorkerSource).toContain("operation === 'aggregate'")
    expect(spreadsheetWorkerSource).toContain("operation === 'join'")
    expect(artifactWorkerSource).toContain("import { PDFDocument } from 'npm:pdf-lib@1.17.1'")
    expect(artifactWorkerSource).toContain("import PptxGenJS from 'npm:pptxgenjs@4.0.1'")
    expect(artifactWorkerSource).toContain("model: 'gemini-3.1-flash-image'")
    for (const source of [spreadsheetWorkerSource, artifactWorkerSource]) {
      expect(source).not.toMatch(/\beval\s*\(/u)
      expect(source).not.toContain('new Function(')
    }
  })

  it('keeps artifact intent semantic while execution stays capability-backed', () => {
    expect(coreSource).toContain('ARTIFACT POLICY')
    expect(coreSource).toContain('ASSISTANT_SKILL_TOOLS')
    expect(coreSource).toContain("tool_choice: tools.length ? 'auto' : 'none'")
    expect(coreSource).toContain('captureGeneratedArtifacts')
    expect(coreSource).not.toContain('spreadsheetCreateRequested')
    expect(coreSource).not.toContain('spreadsheetMutationRequested')
    expect(coreSource).not.toContain('artifactMutationRequested')
    expect(coreSource).not.toContain('SPREADSHEET_CREATE_REQUIRED')
    expect(coreSource).not.toContain('ARTIFACT_MUTATION_REQUIRED')
  })
})
