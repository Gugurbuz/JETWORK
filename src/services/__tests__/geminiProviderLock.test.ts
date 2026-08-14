import { describe, expect, it } from 'vitest'
import {
  assertExplicitGeminiModelPreserved,
  isExplicitGeminiModelLocked,
} from '../../../supabase/functions/_shared/geminiProviderLock'

describe('explicit Gemini model lock', () => {
  it('locks Gemini 3.1 Pro when the user explicitly selected it', () => {
    expect(isExplicitGeminiModelLocked('gemini-3.1-pro-preview')).toBe(true)
    expect(() => assertExplicitGeminiModelPreserved(
      'gemini-3.1-pro-preview',
      'gemini-3.5-flash',
    )).toThrow(/EXPLICIT_GEMINI_MODEL_FALLBACK_BLOCKED/)
  })

  it('allows the exact selected Pro model to complete', () => {
    expect(() => assertExplicitGeminiModelPreserved(
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview',
    )).not.toThrow()
  })

  it('does not lock automatic or Flash execution models', () => {
    expect(isExplicitGeminiModelLocked('gemini-3.5-flash')).toBe(false)
    expect(() => assertExplicitGeminiModelPreserved(
      'gemini-3.5-flash',
      'gemini-3.5-flash',
    )).not.toThrow()
  })
})
