import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  classifyDocumentArtifactRequest,
  ENERJISA_ANALYSIS_DOCX_DIRECTIVE,
} from '../../../supabase/functions/_shared/documentArtifactRouting'

const workerSource = readFileSync(new URL('../../../api/docx-worker.py', import.meta.url), 'utf8')
const requirements = readFileSync(new URL('../../../requirements.txt', import.meta.url), 'utf8')
const executionToolsSource = readFileSync(new URL('../../../supabase/functions/_shared/artifactExecutionTools.ts', import.meta.url), 'utf8')
const assistantToolSource = readFileSync(new URL('../../../supabase/functions/_shared/artifactAssistantTool.ts', import.meta.url), 'utf8')
const authoritativeSource = readFileSync(new URL('../../../supabase/functions/_shared/assistantToolsAuthoritativeEvidence.ts', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8')
const routeSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2-entry-router/index.ts', import.meta.url), 'utf8')
const edgeWorkerSource = readFileSync(new URL('../../../supabase/functions/docx-execute/index.ts', import.meta.url), 'utf8')

describe('Python DOCX artifact worker', () => {
  it('uses python-docx and reloads the generated package for structural QA', () => {
    expect(requirements).toContain('python-docx==1.2.0')
    expect(workerSource).toContain('from docx import Document')
    expect(workerSource).toContain('_render_markdown')
    expect(workerSource).toContain('_add_markdown_table')
    expect(workerSource).toContain('reloaded = Document(io.BytesIO(raw))')
    expect(workerSource).toContain('"engine": "python-docx"')
  })

  it('accepts rich Markdown DOCX content instead of only flat paragraphs', () => {
    expect(executionToolsSource).toContain("name: 'create_document_file'")
    expect(executionToolsSource).toContain("markdown: nullableText(400_000)")
    expect(executionToolsSource).toContain('headerText: nullableText(500)')
    expect(executionToolsSource).toContain('footerText: nullableText(500)')
    expect(executionToolsSource).toContain('metadata:')
  })

  it('routes DOCX creation to the dedicated Python executor while keeping other artifacts unchanged', () => {
    expect(assistantToolSource).toContain("? 'docx-execute'")
    expect(assistantToolSource).toContain(": 'artifact-execute'")
    expect(edgeWorkerSource).toContain("engine: 'python-docx'")
    expect(edgeWorkerSource).toContain("storageBucket: ASSISTANT_FILES_BUCKET")
  })

  it('keeps artifact tools visible through the authoritative production wrapper', () => {
    expect(authoritativeSource).toContain('...ASSISTANT_ARTIFACT_TOOLS')
    expect(authoritativeSource).toContain('isArtifactExecutionTool(toolName)')
    expect(authoritativeSource).toContain('executeArtifactAssistantTool')
  })

  it('surfaces DOCX tool outputs in the web client instead of filtering everything except XLSX', () => {
    expect(runtimeSource).toContain("docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'")
    expect(runtimeSource).toContain('TOOL_OUTPUT_MIMES')
    expect(runtimeSource).not.toContain("if (!/\\.xlsx$/i.test(name) && mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')")
  })

  it('defaults analysis-document creation to the Enerjisa DOCX artifact profile without requiring Word', () => {
    expect(classifyDocumentArtifactRequest('analiz dokümanı yaz')).toEqual({
      artifactRoute: true,
      enerjisaAnalysisDocx: true,
      reason: 'enerjisa_analysis_document',
    })
    expect(classifyDocumentArtifactRequest('İYS ile CRM entegrasyonu için kapsamlı bir analiz dokümanı oluştur').enerjisaAnalysisDocx).toBe(true)
    expect(classifyDocumentArtifactRequest('Analiz oluştur').enerjisaAnalysisDocx).toBe(true)
    expect(classifyDocumentArtifactRequest('bu konuyu analiz et').artifactRoute).toBe(false)
    expect(classifyDocumentArtifactRequest('mevcut analiz dokümanını özetle').artifactRoute).toBe(false)
    expect(routeSource).toContain('enerjisa-analysis-docx-v1')
    expect(routeSource).toContain('applyEnerjisaAnalysisDocxProfile')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('create_document_file')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('# İHTİYAÇ ANALİZİ')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('## 8. FONKSİYONEL TASARIM DOKÜMANLARI')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('[AÇIK KONU]')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).not.toContain("Canvas'a")
  })

  it('keeps generic explicit Word requests on the DOCX runtime without imposing the Enerjisa analysis profile', () => {
    expect(classifyDocumentArtifactRequest('Word olarak kısa bir toplantı notu hazırla')).toEqual({
      artifactRoute: true,
      enerjisaAnalysisDocx: false,
      reason: 'explicit_docx',
    })
    expect(routeSource).toContain("'openai-assistant-v2-internal'")
    expect(routeSource).toContain("'openai-assistant-v2-primary'")
    expect(routeSource).toContain('docx-reasoning-v2')
  })
})
