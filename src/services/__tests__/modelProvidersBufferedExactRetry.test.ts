import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBufferedExactRetry.ts', import.meta.url),
  'utf8',
)

describe('buffered exact identifier provider retry', () => {
  it('is restricted to direct no-retrieval non-Pro turns', () => {
    expect(source).toContain("if (input.model === EXPLICIT_PRO_MODEL) return false")
    expect(source).toContain("if (plan.executionMode !== 'direct') return false")
    expect(source).toContain("if (plan.webMode !== 'none') return false")
    expect(source).toContain('if (plan.knowledgeRequired === true || plan.enterpriseGroundingRequired === true) return false')
    expect(source).toContain("import { hasExactTechnicalIdentifier } from './technicalIdentifier.ts'")
    expect(source).toContain('return hasExactTechnicalIdentifier(lastUserText(input.items))')
    expect(source).not.toContain('EXACT_CUSTOM_IDENTIFIER_PATTERN')
  })

  it('buffers the first attempt and retries timeout recovery without tools', () => {
    expect(source).toContain('onText: delta => { bufferedText += delta }')
    expect(source).toContain("if (input.signal?.aborted || !isTransientTimeout(error)) throw error")
    expect(source).toContain('tools: []')
    expect(source).toContain('allowTools: false')
    expect(source).toContain('allowProviderWeb: false')
    expect(source).toContain('buffered_exact_identifier_timeout_recovery: 1')
  })
})
