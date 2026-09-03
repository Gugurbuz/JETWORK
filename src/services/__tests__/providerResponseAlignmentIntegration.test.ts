import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providerWrapperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)

describe('provider guarded-text integration', () => {
  it('aligns normalized provider output with both batch-emitted and streaming-guarded text', () => {
    expect(providerWrapperSource).toContain("import { replaceProviderResponseVisibleText } from './providerResponseText.ts'")
    expect(providerWrapperSource).toContain('replaceProviderResponseVisibleText(response, emittedText)')
    expect(providerWrapperSource).toContain('replaceProviderResponseVisibleText(response, guardedText)')
  })
})
