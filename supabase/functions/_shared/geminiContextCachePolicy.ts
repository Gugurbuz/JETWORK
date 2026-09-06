export const GEMINI_CONTEXT_CACHE_CONTRACT_VERSION = 'gemini38-native-implicit-v1'
export const GEMINI_IMPLICIT_CACHE_MIN_TOKENS = 4096
export const GEMINI_LARGE_CONTEXT_DEFAULT_CHARACTERS = 120_000
export const GEMINI_LARGE_CONTEXT_MAX_CHARACTERS = 240_000

const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const estimateGeminiTokens = (characters: number) => Math.ceil(Math.max(0, characters) / 4)

export async function buildGeminiContextCachePolicy(input: {
  workspaceId: string
  projectId?: string | null
  promptVersionId: string
  model: string
  stablePrompt: string
  controllerVersion: string
  capabilityManifestVersion: string
}) {
  const stablePrefixCharacters = String(input.stablePrompt || '').length
  const estimatedStableTokens = estimateGeminiTokens(stablePrefixCharacters)
  const keyMaterial = JSON.stringify({
    contract: GEMINI_CONTEXT_CACHE_CONTRACT_VERSION,
    workspaceId: input.workspaceId,
    projectId: input.projectId || null,
    promptVersionId: input.promptVersionId,
    model: input.model,
    controllerVersion: input.controllerVersion,
    capabilityManifestVersion: input.capabilityManifestVersion,
    stablePromptHash: await sha256Text(String(input.stablePrompt || '')),
  })
  return {
    contractVersion: GEMINI_CONTEXT_CACHE_CONTRACT_VERSION,
    cacheKey: await sha256Text(keyMaterial),
    eligible: input.model === 'gemini-3.8-flash' && estimatedStableTokens >= GEMINI_IMPLICIT_CACHE_MIN_TOKENS,
    stablePrefixCharacters,
    estimatedStableTokens,
    strategy: 'provider_native_implicit' as const,
    invalidatesWhen: ['workspace', 'project', 'prompt_version', 'model', 'controller_version', 'capability_manifest_version', 'stable_prompt_hash'] as const,
  }
}

export const clampLargeContextCharacters = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return GEMINI_LARGE_CONTEXT_DEFAULT_CHARACTERS
  return Math.max(36_000, Math.min(Math.trunc(parsed), GEMINI_LARGE_CONTEXT_MAX_CHARACTERS))
}
