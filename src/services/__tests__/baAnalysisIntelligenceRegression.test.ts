import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator.ts'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const enerjisaSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-enerjisa-docx/index.ts', import.meta.url), 'utf8')
const routingSource = readFileSync(new URL('../../../supabase/functions/_shared/documentArtifactRouting.ts', import.meta.url), 'utf8')
const contractSource = readFileSync(new URL('../../../supabase/functions/_shared/enerjisaDocumentContract.ts', import.meta.url), 'utf8')

describe('BA analysis intelligence regression', () => {
  it('does not promote ordinary Turkish z-words into technical entities', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'openai', model: 'gpt-5.6-sol',
      message: 'Bu süreç üzerinden zamanında düzenlenmesi gereken teklif akışını analiz et. ZCRM_COST_REPORT ile ilişkili noktaları da kontrol et.',
      conversation: [],
    })
    const entities = result.plan.conversationState?.activeEntities || []
    expect(entities).toContain('ZCRM_COST_REPORT')
    expect(entities).not.toContain('ZERINDEN')
    expect(entities).not.toContain('ZAMANDA')
    expect(entities).not.toContain('ZENLENMESI')
  })

  it('keeps Enerjisa specialization deterministic only about the requested artifact', () => {
    expect(enerjisaSource).toContain('buildSemanticExecutionPlan')
    expect(enerjisaSource).toContain("intent: 'document' as const")
    expect(enerjisaSource).toContain("executionMode: 'artifact' as const")
    expect(enerjisaSource).toContain('artifactPreferredTool: DOCUMENT_FILE_EXECUTOR_TOOL')
    expect(enerjisaSource).toContain('Research, skill selection, evidence')
    expect(enerjisaSource).toContain('remain controller-LLM decisions')
    expect(enerjisaSource).not.toContain("id: 'research-enterprise-current-state'")
    expect(enerjisaSource).not.toContain("id: 'analyze-system-impact'")
  })

  it('keeps artifact completion semantic and executor-backed without raw-message artifact regex', () => {
    expect(coreSource).toContain('semanticArtifactRequired')
    expect(coreSource).toContain('SEMANTIC_ARTIFACT_REQUIRED')
    expect(coreSource).toContain('generatedArtifacts.size === 0')
    expect(coreSource).toContain("plan.executionMode !== 'artifact'")
    expect(coreSource).not.toContain('spreadsheetCreateRequested')
    expect(coreSource).not.toContain('artifactMutationRequested')
  })

  it('preserves one canonical Enerjisa template while grounding affected systems dynamically', () => {
    expect(routingSource).toContain('ENERJISA_ANALYSIS_DOCX_DIRECTIVE')
    expect(contractSource).toContain("ENERJISA_DOCUMENT_CONTRACT_VERSION = 'enerjisa-analysis-docx-v2'")
    expect(contractSource).toContain('Başlık/Açıklama tablosunda en az Sistem, Modül, Etkilenen Süreç')
    expect(contractSource).toContain('### 6.2. Bağımlılıklar')
    expect(contractSource).toContain('### 8.2. Teknik Gereksinimler')
    expect(contractSource).toContain('etkilenen sistemler, sistem sahipliği ve entegrasyon iddiaları')
    expect(contractSource).toContain('controller uygun capabilitylerle toplasın')
    expect(routingSource).not.toContain('### 1.1. Platform ve Sistem Etki Analizi')
    expect(routingSource).not.toContain('### 6.4. Açık Konular ve Karar Gerektiren Sorular')
  })
})