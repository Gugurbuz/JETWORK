import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const core = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const bridge = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2-primary-bridge-evidence/index.ts', import.meta.url), 'utf8')

describe('long requirement runtime integration', () => {
  it('passes the current message into grounding coverage', () => {
    expect(core).toContain('currentUserText: message')
  })
  it('uses the shared technical identifier detector in the primary model router', () => {
    expect(bridge).toContain("import { extractExactTechnicalIdentifiers } from '../_shared/technicalIdentifier.ts'")
    expect(bridge).toContain('extractExactTechnicalIdentifiers(input.message, 6)')
    expect(bridge).not.toContain('const TECHNICAL_IDENTIFIER =')
  })
})
