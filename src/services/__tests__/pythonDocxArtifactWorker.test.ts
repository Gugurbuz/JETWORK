import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

  it('routes only explicit Word/DOCX output requests away from the primary low-latency path', () => {
    expect(routeSource).toContain('requiresDocxArtifactRuntime')
    expect(routeSource).toContain("'openai-assistant-v2-internal'")
    expect(routeSource).toContain("'openai-assistant-v2-primary'")
    expect(routeSource).toContain('docx-reasoning-v2')
  })
})
