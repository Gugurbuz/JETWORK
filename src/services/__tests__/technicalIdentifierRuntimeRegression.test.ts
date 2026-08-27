import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const core = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const adapter = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersBufferedExactRetry.ts', import.meta.url), 'utf8')
const semantic = readFileSync(new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url), 'utf8')

describe('structured identifier runtime integration', () => {
  it('uses the shared detector in the core streaming guard', () => {
    expect(core).toContain("import { hasExactTechnicalIdentifier } from '../_shared/technicalIdentifier.ts'")
    expect(core).toContain('const hasExactCustomIdentifierInRequest = hasExactTechnicalIdentifier(message)')
    expect(core).not.toContain("message.toLocaleUpperCase('en-US')")
  })

  it('uses the same detector in buffered timeout recovery', () => {
    expect(adapter).toContain("import { hasExactTechnicalIdentifier } from './technicalIdentifier.ts'")
    expect(adapter).toContain('return hasExactTechnicalIdentifier(lastUserText(input.items))')
    expect(adapter).not.toContain('EXACT_CUSTOM_IDENTIFIER_PATTERN')
  })

  it('uses the shared extractor in semantic planning', () => {
    expect(semantic).toContain("import { extractExactTechnicalIdentifiers } from './technicalIdentifier.ts'")
    expect(semantic).toContain('extractExactTechnicalIdentifiers(value, 10)')
    expect(semantic).not.toContain('PLAIN_UPPERCASE_Z_ENTITY_PATTERN')
  })
})
