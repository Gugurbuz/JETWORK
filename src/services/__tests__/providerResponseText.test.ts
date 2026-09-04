import { describe, expect, it } from 'vitest'
import { replaceProviderResponseVisibleText } from '../../../supabase/functions/_shared/providerResponseText'

describe('provider response visible-text alignment', () => {
  it('replaces the normalized visible text with the guarded text', () => {
    const response = {
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'unsafe provider draft', annotations: [] }],
      }],
    }

    const aligned = replaceProviderResponseVisibleText(response, 'guarded final text')
    const output = aligned.output as Array<Record<string, unknown>>
    const content = output[0].content as Array<Record<string, unknown>>
    expect(content[0].text).toBe('guarded final text')
  })

  it('clears additional provider text parts so stale draft text cannot reach downstream grounding', () => {
    const response = {
      output: [{
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'first unsafe fragment' },
          { type: 'output_text', text: 'second unsafe fragment' },
        ],
      }],
    }

    const aligned = replaceProviderResponseVisibleText(response, 'single guarded answer')
    const output = aligned.output as Array<Record<string, unknown>>
    const content = output[0].content as Array<Record<string, unknown>>
    expect(content[0].text).toBe('single guarded answer')
    expect(content[1].text).toBe('')
  })

  it('preserves function calls while appending guarded text when the response has no message item', () => {
    const response: { output: Array<Record<string, unknown>> } = {
      output: [{ type: 'function_call', name: 'search_knowledge_catalog', call_id: 'call-1' }],
    }

    const aligned = replaceProviderResponseVisibleText(response, 'guarded answer')
    expect(aligned.output[0].type).toBe('function_call')
    expect(aligned.output[1].type).toBe('message')
    const content = aligned.output[1].content as Array<Record<string, unknown>>
    expect(content[0].text).toBe('guarded answer')
  })
})
