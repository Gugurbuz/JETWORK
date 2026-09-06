import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
  'utf8',
)

describe('Gemini 3.8 thought-signature continuity', () => {
  it('replays provider candidate content across manual function-calling rounds', () => {
    expect(source).toContain('const geminiContent = item._geminiContent')
    expect(source).toContain('contents.push(geminiContent as Record<string, unknown>)')
    expect(source).toContain('providerFunctionCallIds.add(callId)')
    expect(source).toContain('_geminiContent: index === 0 ? candidateContent : undefined')
    expect(source).toContain('_geminiSkipContent: index > 0')
    expect(source).toContain('cannot carry a valid Gemini thought signature')
  })

  it('keeps deterministic internal calls out of Gemini protocol history', () => {
    expect(source).toContain('Internal/deterministic function calls were not emitted by Gemini')
    expect(source).toContain('Never replay them as functionCall history')
  })
})
