import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ENERJISA_ANALYSIS_DOCX_DIRECTIVE,
  ENERJISA_DOCUMENT_CONTRACT_VERSION,
  ENERJISA_DOCUMENT_SECTIONS,
} from '../../../supabase/functions/_shared/enerjisaDocumentContract.ts'

const evidenceToolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/context/contextTools.ts', import.meta.url),
  'utf8',
)
const controllerPolicySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)
const docxOrchestratorSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-enerjisa-docx/index.ts', import.meta.url),
  'utf8',
)
const documentRoutingSource = readFileSync(
  new URL('../../../supabase/functions/_shared/documentArtifactRouting.ts', import.meta.url),
  'utf8',
)

describe('Deep Analyst Runtime V3 contract', () => {
  it('keeps evidence coverage and critic as observations, never next-tool authority', () => {
    expect(evidenceToolSource).toContain("name: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME")
    expect(evidenceToolSource).toContain('coverage/gap/conflict critic observations')
    expect(evidenceToolSource).toContain('does not search, select the next capability, or finalize the answer')
    expect(evidenceToolSource).toContain('controllerDecisionRequired: true')
    expect(controllerPolicySource).toContain('Her tool observationından sonra')
  })

  it('keeps the Enerjisa DOCX endpoint deterministic only about the requested artifact', () => {
    expect(docxOrchestratorSource).toContain("artifactRequired: true")
    expect(docxOrchestratorSource).toContain('artifactPreferredTool: DOCUMENT_FILE_EXECUTOR_TOOL')
    expect(docxOrchestratorSource).not.toContain("webMode: 'none'")
    expect(docxOrchestratorSource).not.toContain('research-enterprise-current-state')
    expect(docxOrchestratorSource).not.toContain('analyze-system-impact')
    expect(docxOrchestratorSource).not.toContain('evidenceQueries: [')
    expect(docxOrchestratorSource).toContain('Research, skill selection, evidence')
  })

  it('has one versioned canonical Enerjisa contract consumed by document routing', () => {
    expect(ENERJISA_DOCUMENT_CONTRACT_VERSION).toBe('enerjisa-analysis-docx-v2')
    expect(ENERJISA_DOCUMENT_SECTIONS.length).toBeGreaterThan(20)
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('Şablon araştırma planı değildir')
    expect(ENERJISA_ANALYSIS_DOCX_DIRECTIVE).toContain('Kanıt, kullanıcı talebi, analitik çıkarım, öneri ve açık kararı birbirinden ayır')
    expect(documentRoutingSource).toContain("from './enerjisaDocumentContract.ts'")
    expect(documentRoutingSource).not.toContain('ENERJİSA İŞ ANALİZİ ŞABLONU')
  })
})
