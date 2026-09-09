// Isolated production Controller V3 core.
//
// The rollout switch is process-local to this dedicated Edge Function identity;
// request headers/body/user content cannot influence it. The shared durable core
// remains rollback-compatible while this entry guarantees the V3 semantic path.
import { installGeminiProviderWebQuotaFallback } from '../_shared/geminiProviderWebQuotaFallback.ts'

const PRIMARY_GEMINI_MODEL = 'gemini-3.8-flash'
const RECOVERY_GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_INTERACTIONS_PATH = '/v1/interactions'
const GEMINI_QUOTA_PATTERN = /quota|billing|resource_exhausted|rate.?limit/i
const MODEL_RECOVERY_CIRCUIT_MS = 60_000
const CONTROLLER_EVIDENCE_COMPLETION_POLICY = [
  'EVIDENCE_COMPLETION_POLICY: When an exact or canonical enterprise candidate has been found for the user request, do not conclude that context is missing merely because the first search was ambiguous.',
  'For exact technical answers, messages, ABAP, implementation, or source-code requests, inspect enough of the candidate detail, evidence, relations, or literal source before deciding that the answer is unavailable or asking the user for context already represented by verified enterprise evidence.',
  'Once an exact canonical candidate is verified, prefer completing that candidate-specific evidence lineage before returning to broad catalog enumeration; broad enumeration is still available when you judge that competing candidates remain materially plausible. If the requested literal or implementation is not present in the exact detail itself, continue candidate-specific evidence traversal until you can either verify the requested literal/source or establish from available evidence that no verified body is present.',
  'If the exact object is only a structural endpoint, signature, summary, or relation and no verified implementation body is available, preserve the exact object name and state clearly that the full implementation source is not available; never invent the body.',
  'Capability choice, query formulation, evidence traversal, further research, and the stop/final decision remain solely yours as the Controller LLM. This policy does not select a tool, query, route, or answer.',
].join(' ')

let geminiModelRecoveryUntil = 0
let geminiModelRecoveryInstalled = false

const requestUrl = (input: RequestInfo | URL) => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const parseJsonBody = (body: BodyInit | null | undefined): Record<string, unknown> | null => {
  if (typeof body !== 'string' || !body.trim()) return null
  try {
    const parsed = JSON.parse(body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const withControllerEvidenceCompletionPolicy = (body: Record<string, unknown>) => ({
  ...body,
  system_instruction: [
    String(body.system_instruction || '').trim(),
    CONTROLLER_EVIDENCE_COMPLETION_POLICY,
  ].filter(Boolean).join('\n\n'),
})

const isGeminiQuotaResponse = async (response: Response) => {
  if (response.status !== 429) return false
  const text = await response.clone().text().catch(() => '')
  return !text || GEMINI_QUOTA_PATTERN.test(text)
}

const normalizedGeminiQuotaResponse = () => new Response(
  JSON.stringify({ error: { message: 'Gemini quota exceeded.' } }),
  {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
  },
)

/**
 * Mechanical provider-availability recovery plus Controller-level evidence
 * completion guidance. The guidance changes only the same Controller LLM's
 * system instruction; it never selects a capability, query, route, or answer.
 *
 * Gemini remains the selected provider and semantic controller. The public
 * primary stays Gemini 3.8 Flash. Only a real upstream 429/quota condition opens
 * a short circuit and retries the same Interactions request on Gemini 3.5 Flash.
 * There is deliberately no OpenAI fallback and no semantic/tool decision here.
 */
const installGeminiModelQuotaRecovery = () => {
  if (geminiModelRecoveryInstalled) return
  geminiModelRecoveryInstalled = true
  const originalFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const parsedBody = parseJsonBody(init?.body)
    if (
      !url.includes('generativelanguage.googleapis.com')
      || !url.includes(GEMINI_INTERACTIONS_PATH)
      || !parsedBody
    ) {
      return originalFetch(input, init)
    }

    const body = withControllerEvidenceCompletionPolicy(parsedBody)
    if (String(body.model || '') !== PRIMARY_GEMINI_MODEL) {
      return originalFetch(input, { ...init, body: JSON.stringify(body) })
    }

    const recoveryBody = {
      ...body,
      model: RECOVERY_GEMINI_MODEL,
      system_instruction: [
        String(body.system_instruction || '').trim(),
        'RUNTIME_PROVIDER_RECOVERY: Gemini 3.8 Flash is temporarily quota-unavailable. Continue as the same Gemini controller using Gemini 3.5 Flash. Do not claim OpenAI was used.',
      ].filter(Boolean).join('\n\n'),
    }
    const retryRecovery = async () => {
      const retry = await originalFetch(input, { ...init, body: JSON.stringify(recoveryBody) })
      if (await isGeminiQuotaResponse(retry)) return normalizedGeminiQuotaResponse()
      return retry
    }

    if (Date.now() < geminiModelRecoveryUntil) return retryRecovery()

    const response = await originalFetch(input, { ...init, body: JSON.stringify(body) })
    if (!await isGeminiQuotaResponse(response)) return response

    geminiModelRecoveryUntil = Date.now() + MODEL_RECOVERY_CIRCUIT_MS
    try { await response.body?.cancel() } catch {}
    console.warn('GEMINI_MODEL_QUOTA_RECOVERY', JSON.stringify({
      primary: PRIMARY_GEMINI_MODEL,
      recovery: RECOVERY_GEMINI_MODEL,
    }))
    return retryRecovery()
  }) as typeof globalThis.fetch
}

const originalEnvGet = Deno.env.get.bind(Deno.env)
Deno.env.get = ((key: string) => (
  key === 'AGENT_CONTROLLER_V2' ? 'true' : originalEnvGet(key)
)) as typeof Deno.env.get

installGeminiModelQuotaRecovery()
installGeminiProviderWebQuotaFallback()
await import('../openai-assistant-core-v2/index.ts')
