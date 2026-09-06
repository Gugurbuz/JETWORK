import { describe, expect, it } from 'vitest'
import {
  deterministicTrivialResponseForMessage,
  executionModelForTrivialFastPathModel,
  shouldUseTrivialAssistantFastPath,
} from '../../../supabase/functions/_shared/trivialAssistantFastPath'

describe('clarification TTFT fast path', () => {
  const message = 'Bir talebim var; proje mi support konusu mu olduğunu birlikte netleştirelim.'

  it('routes low-risk clarification handshakes to the trivial lane', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message,
      model: 'gemini-3.8-flash',
      attachmentCount: 0,
    })).toBe(true)
  })

  it('returns a deterministic clarification response without a provider call', () => {
    expect(deterministicTrivialResponseForMessage(message)).toContain('Talebi anlat')
  })

  it('migrates legacy Gemini selections to 3.8 Flash on the trivial lane', () => {
    expect(executionModelForTrivialFastPathModel('gemini-3.1-pro-preview')).toBe('gemini-3.8-flash')
    expect(executionModelForTrivialFastPathModel('gemini-3.5-flash')).toBe('gemini-3.8-flash')
  })

  it('keeps substantive project requests out of the trivial lane', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'Bir talebim var. SAP CRM teklif save sürecinde pricing ve RFC etkisini analiz et.',
      model: 'auto',
      attachmentCount: 0,
    })).toBe(false)
  })
})
