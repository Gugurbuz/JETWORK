import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')

describe('runtime semantic grounding removal contract', () => {
  it('cannot replace a Controller answer with the former generic grounding failure text', () => {
    expect(coreSource).not.toContain('Bu teknik yanıtı güvenli biçimde tamamlayamadım:')
    expect(coreSource).not.toContain('groundingFailureText')
    expect(coreSource).not.toContain('ASSISTANT_GROUNDING_COVERAGE_BLOCKED')
  })
})
