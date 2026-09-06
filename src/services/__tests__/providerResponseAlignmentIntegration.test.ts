import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const interactionsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsAgent.ts', import.meta.url),
  'utf8',
)

describe('provider streamed-text integration', () => {
  it('builds normalized model output from the same Interactions deltas emitted to the client callback', () => {
    expect(interactionsSource).toContain('builder.text += delta.text')
    expect(interactionsSource).toContain('input.onText(delta.text)')
    expect(interactionsSource).toContain('completedSteps.push(finalizeStreamingStep(builder))')
    expect(interactionsSource).toContain('normalizeGeminiInteraction({ ...interaction, steps: completedSteps })')
  })
})
