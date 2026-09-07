import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const transportSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsTransportGA.ts', import.meta.url),
  'utf8',
)

describe('provider streamed-text integration', () => {
  it('builds normalized model output from the same GA Interactions deltas emitted to the client callback', () => {
    expect(transportSource).toContain('builder.text += delta.text')
    expect(transportSource).toContain('input.onText(delta.text)')
    expect(transportSource).toContain('completedSteps.push(finalizeStreamingStep(builder))')
    expect(transportSource).toContain('normalizeGeminiInteraction({ ...interaction, steps: completedSteps })')
  })
})
