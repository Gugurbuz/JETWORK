export type ProviderResponseWithOutput = {
  output?: Array<Record<string, unknown>>
}

const CANONICAL_KEY_LITERAL_PATTERN = /\b(?:message|class|method|function|table|interface|document|business_rule):[a-z0-9_./-]+\b/gi

/** Canonical knowledge keys are storage/provenance identifiers, not display labels. */
export const canonicalizeProviderCanonicalKeyLiterals = (text: string) => String(text ?? '')
  .replace(CANONICAL_KEY_LITERAL_PATTERN, value => value.toLocaleLowerCase('en-US'))

/**
 * Provider answerability/grounding guards may rewrite buffered visible text.
 * Keep the normalized provider response in sync with the text emitted to the
 * user so downstream grounding evaluates the same draft that passed preflight.
 * Canonical knowledge-key literals are normalized mechanically to their
 * lowercase provenance form; this is serialization integrity, not semantic
 * routing or identifier inference.
 */
export const replaceProviderResponseVisibleText = <T extends ProviderResponseWithOutput>(
  response: T,
  text: string,
): T => {
  const safeText = canonicalizeProviderCanonicalKeyLiterals(String(text ?? ''))
  let assigned = false

  const output = (response.output || []).map(item => {
    if (String(item.type || '') !== 'message' || !Array.isArray(item.content)) return item

    const content = (item.content as Array<Record<string, unknown>>).map(part => {
      if (typeof part.text !== 'string') return part
      if (!assigned) {
        assigned = true
        return { ...part, text: safeText }
      }
      return { ...part, text: '' }
    })

    if (!assigned && safeText.trim()) {
      assigned = true
      content.push({ type: 'output_text', text: safeText })
    }

    return { ...item, content }
  })

  if (!assigned && safeText.trim()) {
    output.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: safeText }],
    })
  }

  return { ...response, output } as T
}
