export interface NormalizedGeminiFunctionCall {
  id: string
  name: string
  args: Record<string, unknown>
}

const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/

export const normalizeGeminiFunctionCalls = (parts: readonly unknown[]): NormalizedGeminiFunctionCall[] => {
  const calls: NormalizedGeminiFunctionCall[] = []
  const ids = new Set<string>()
  for (const rawPart of parts) {
    if (!rawPart || typeof rawPart !== 'object') continue
    const functionCall = (rawPart as Record<string, unknown>).functionCall
    if (!functionCall || typeof functionCall !== 'object') continue
    const call = functionCall as Record<string, unknown>
    const id = String(call.id || '').trim()
    const name = String(call.name || '').trim()
    if (!id) throw new Error('GEMINI_FUNCTION_CALL_ID_MISSING')
    if (!FUNCTION_NAME.test(name)) throw new Error('GEMINI_FUNCTION_CALL_NAME_INVALID')
    if (ids.has(id)) throw new Error('GEMINI_FUNCTION_CALL_ID_DUPLICATE')
    ids.add(id)
    const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args)
      ? call.args as Record<string, unknown>
      : {}
    calls.push({ id, name, args })
  }
  return calls
}
