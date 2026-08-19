import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
)

describe('BA analysis provider parity', () => {
  it('injects the shared BA contract into Gemini synthesis', () => {
    expect(providerSource).toContain("const baAnalysisInstruction = baAnalysisInstructionForPlan(plan)")
    expect(providerSource).toMatch(/geminiInstructions = \[[\s\S]*baAnalysisInstruction/)
    expect(providerSource).toMatch(/recoveryInstructions = \[[\s\S]*baAnalysisInstruction/)
  })

  it('injects the same BA contract into the OpenAI developer item', () => {
    expect(providerSource).toContain('const openAiPrimaryAgentDeveloperItem = (items: Array<Record<string, unknown>>) =>')
    expect(providerSource).toMatch(/openAiPrimaryAgentDeveloperItem[\s\S]*baAnalysisInstructionForPlan\(plan\)/)
    expect(providerSource).toContain('openAiPrimaryAgentDeveloperItem(items)')
  })
})
