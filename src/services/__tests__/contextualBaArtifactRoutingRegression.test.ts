import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('contextual BA artifact routing regression', () => {
  const orchestrator = fs.readFileSync('supabase/functions/_shared/semanticOrchestrator.ts','utf8')
  const router = fs.readFileSync('supabase/functions/openai-assistant-v2-entry-router/index.ts','utf8')
  it('requires enterprise knowledge for structured requirements', () => {
    expect(orchestrator).toContain('knowledgeRequired: userProvidedRequirements ? true : route.knowledgeRequired')
    expect(orchestrator).toContain('enterpriseGroundingRequired: userProvidedRequirements')
    expect(orchestrator).toContain('enterpriseGroundingRequired: inputPlan.enterpriseGroundingRequired === true')
  })
  it('carries prior BA context into first-time document follow-ups', () => {
    expect(router).toContain('loadRecentArtifactContext')
    expect(router).toContain('contextualEnerjisaCreation')
    expect(router).toContain('[KULLANICI DEVAM TALİMATI]')
    expect(router).toContain('enerjisa-analysis-docx-contextual-v1')
  })
})
