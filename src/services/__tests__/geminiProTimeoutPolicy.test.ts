import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourcePath = fileURLToPath(new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

describe('Gemini Pro provider policy', () => {
  it('gives explicit Pro a full bounded response window', () => {
    expect(source).toContain('const GEMINI_PRO_ATTEMPT_TIMEOUT_MS = 45_000')
  })

  it('does not fail over explicit Pro to Flash', () => {
    expect(source).toContain('if (executionModel === GEMINI_SUBSTANTIVE_MODEL) throw error')
    expect(source).not.toContain('switching immediately to same-provider stable Flash fallback')
    expect(source).not.toContain('GEMINI_PRO_CIRCUIT_BREAKER_MS')
  })

  it('does not retry a full Pro timeout but can retry quick transient failures', () => {
    expect(source).toContain('if (isExplicitPro && isGeminiAttemptTimeout(error))')
    expect(source).toContain('retrying the same selected model once with bounded backoff')
  })
})
