import { buildOpenAiEnumerationFastPathResponse } from './enumerationFastPath.ts'

export type OpenAiFailureCategory =
  | 'quota_or_billing'
  | 'rate_limit'
  | 'auth'
  | 'provider_error'
  | 'network'
  | 'unknown'

export interface OpenAiCircuitState {
  blockedUntil: number
  reason: OpenAiFailureCategory | null
}

export interface OpenAiCircuitBreakerOptions {
  now?: () => number
  quotaCooldownMs?: number
  authCooldownMs?: number
  rateLimitCooldownMs?: number
  providerCooldownMs?: number
  networkCooldownMs?: number
}

const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 1000
const DEFAULT_PROVIDER_COOLDOWN_MS = 15 * 1000
const DEFAULT_NETWORK_COOLDOWN_MS = 10 * 1000
const OPENAI_HOST = 'api.openai.com'

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error ?? '')

export function classifyOpenAiFailure(
  status?: number,
  message = '',
  options: OpenAiCircuitBreakerOptions = {},
): { category: OpenAiFailureCategory; cooldownMs: number } {
  const normalized = message.toLocaleLowerCase('en-US')
  if (/insufficient_quota|no credits remaining|billing|credit balance|quota.*exceeded/.test(normalized)) {
    return {
      category: 'quota_or_billing',
      cooldownMs: options.quotaCooldownMs ?? DEFAULT_QUOTA_COOLDOWN_MS,
    }
  }
  if (status === 401 || status === 403 || /invalid api key|incorrect api key|authentication/.test(normalized)) {
    return {
      category: 'auth',
      cooldownMs: options.authCooldownMs ?? DEFAULT_AUTH_COOLDOWN_MS,
    }
  }
  if (status === 429 || /rate limit/.test(normalized)) {
    return {
      category: 'rate_limit',
      cooldownMs: options.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    }
  }
  if (status != null && status >= 500) {
    return {
      category: 'provider_error',
      cooldownMs: options.providerCooldownMs ?? DEFAULT_PROVIDER_COOLDOWN_MS,
    }
  }
  if (/fetch failed|econnreset|enotfound|network|connection reset|socket hang up/.test(normalized)) {
    return {
      category: 'network',
      cooldownMs: options.networkCooldownMs ?? DEFAULT_NETWORK_COOLDOWN_MS,
    }
  }
  return { category: 'unknown', cooldownMs: 0 }
}

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

const isOpenAiRequest = (input: Parameters<typeof fetch>[0]): boolean => {
  try {
    return new URL(requestUrl(input)).hostname === OPENAI_HOST
  } catch {
    return false
  }
}

const requestJsonBody = (init?: RequestInit): Record<string, unknown> | null => {
  if (typeof init?.body !== 'string') return null
  try {
    const parsed = JSON.parse(init.body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const responseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = await response.clone().json() as Record<string, unknown>
    const error = payload.error && typeof payload.error === 'object'
      ? payload.error as Record<string, unknown>
      : undefined
    const message = error?.message ?? payload.message
    if (typeof message === 'string') return message.slice(0, 1_000)
  } catch {
    // Fall through to plain text parsing.
  }
  try {
    return (await response.clone().text()).slice(0, 1_000)
  } catch {
    return ''
  }
}

const logFailureCategory = (
  category: OpenAiFailureCategory,
  cooldownMs: number,
  status?: number,
) => {
  console.warn('[provider-circuit] OpenAI provider degraded', {
    category,
    status: status ?? null,
    cooldownMs,
  })
}

export function createOpenAiCircuitBreaker(
  baseFetch: typeof fetch,
  options: OpenAiCircuitBreakerOptions = {},
) {
  const now = options.now ?? (() => Date.now())
  let state: OpenAiCircuitState = { blockedUntil: 0, reason: null }

  const reset = () => {
    state = { blockedUntil: 0, reason: null }
  }

  const open = (category: OpenAiFailureCategory, cooldownMs: number) => {
    if (cooldownMs <= 0) return
    state = {
      blockedUntil: Math.max(state.blockedUntil, now() + cooldownMs),
      reason: category,
    }
  }

  const wrappedFetch: typeof fetch = async (input, init) => {
    if (!isOpenAiRequest(input)) return baseFetch(input, init)

    const enumerationFastPath = buildOpenAiEnumerationFastPathResponse(requestJsonBody(init))
    if (enumerationFastPath) {
      console.info('[provider-circuit] deterministic enumeration dispatch; OpenAI provider call avoided')
      return enumerationFastPath
    }

    if (state.reason && state.blockedUntil > now()) {
      return new Response(JSON.stringify({
        error: {
          message: `JetWork OpenAI provider circuit open: ${state.reason}.`,
          type: 'jetwork_provider_circuit_open',
        },
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (state.blockedUntil <= now()) reset()

    try {
      const response = await baseFetch(input, init)
      if (response.ok) {
        reset()
        return response
      }

      const detail = await responseErrorMessage(response)
      const failure = classifyOpenAiFailure(response.status, detail, options)
      logFailureCategory(failure.category, failure.cooldownMs, response.status)
      open(failure.category, failure.cooldownMs)
      return response
    } catch (error) {
      const message = errorText(error)
      // Caller-driven aborts must never poison provider health.
      if (!/abort|timeout/i.test(message)) {
        const failure = classifyOpenAiFailure(undefined, message, options)
        logFailureCategory(failure.category, failure.cooldownMs)
        open(failure.category, failure.cooldownMs)
      }
      throw error
    }
  }

  return {
    fetch: wrappedFetch,
    getState: (): OpenAiCircuitState => ({ ...state }),
    reset,
  }
}

let globalCircuitInstalled = false
let globalCircuitState: (() => OpenAiCircuitState) | null = null

export function installOpenAiCircuitBreaker(): void {
  if (globalCircuitInstalled) return
  const breaker = createOpenAiCircuitBreaker(globalThis.fetch.bind(globalThis))
  globalThis.fetch = breaker.fetch
  globalCircuitState = breaker.getState
  globalCircuitInstalled = true
}

export function getOpenAiCircuitState(): OpenAiCircuitState {
  return globalCircuitState?.() ?? { blockedUntil: 0, reason: null }
}
