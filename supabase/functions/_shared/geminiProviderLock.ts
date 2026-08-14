export const EXPLICIT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview'

export const isExplicitGeminiModelLocked = (requestedModel: string): boolean => (
  requestedModel === EXPLICIT_GEMINI_PRO_MODEL
)

export const assertExplicitGeminiModelPreserved = (
  requestedModel: string,
  actualModel: string | undefined,
): void => {
  if (!isExplicitGeminiModelLocked(requestedModel)) return
  const actual = String(actualModel || requestedModel).trim()
  if (!actual || actual === requestedModel) return
  throw new Error(
    `EXPLICIT_GEMINI_MODEL_FALLBACK_BLOCKED: ${requestedModel} was selected, but the provider returned ${actual}.`,
  )
}
