import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator.ts'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const enerjisaSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-enerjisa-docx/index.ts', import.meta.url), 'utf8')
const routingSource = readFileSync(new URL('../../../supabase/functions/_shared/documentArtifactRouting.ts', import.meta.url), 'utf8')

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

  it('forces Enerjisa BA specialization to research enterprise current state and platform impact', () => {
    expect(enerjisaSource).toContain('knowledgeRequired: true')
    expect(enerjisaSource).toContain('enterpriseGroundingRequired: true')
    expect(enerjisaSource).toContain("id: 'research-enterprise-current-state'")
    expect(enerjisaSource).toContain("id: 'analyze-platform-impact'")
    expect(enerjisaSource).toContain('platform-sistem sahipliği')
  })

  it('keeps artifact completion semantic and executor-backed without raw-message artifact regex', () => {
    expect(coreSource).toContain('semanticArtifactRequired')
    expect(coreSource).toContain('SEMANTIC_ARTIFACT_REQUIRED')
    expect(coreSource).toContain('generatedArtifacts.size === 0')
    expect(coreSource).toContain("plan.executionMode !== 'artifact'")
    expect(coreSource).not.toContain('spreadsheetCreateRequested')
    expect(coreSource).not.toContain('artifactMutationRequested')
  })

  it('requires platform analysis and unresolved decision questions in Enerjisa document profile', () => {
    expect(routingSource).toContain('Platform ve Sistem Etki Analizi')
    expect(routingSource).toContain('Açık Konular ve Karar Gerektiren Sorular')
    expect(routingSource).toContain('önce kurumsal kaynakta doğrula')
    expect(routingSource).toContain('en fazla 5 kritik karar sorusunu')
  })
})
