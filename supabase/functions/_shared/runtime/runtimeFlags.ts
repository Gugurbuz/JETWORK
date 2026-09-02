export const AGENT_CONTROLLER_V2_FLAG = 'AGENT_CONTROLLER_V2'
export const LEGACY_AGENT_CONTROLLER_FLAG = 'ASSISTANT_AGENTIC_CONTROLLER'

type EnvReader = (name: string) => string | undefined

const parseBooleanFlag = (value: string | undefined): boolean | null => {
  if (value === undefined) return null
  const normalized = value.trim().toLocaleLowerCase('en-US')
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

const defaultEnvReader: EnvReader = (name) => {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } }
  }
  return runtime.Deno?.env?.get?.(name)
}

/**
 * Canonical Agentic Runtime rollout flag.
 *
 * Production-safe invariant: missing/invalid configuration means OFF. The legacy
 * flag is accepted temporarily so existing preview environments can migrate
 * without silently enabling the new runtime.
 */
export const isAgentControllerV2Enabled = (readEnv: EnvReader = defaultEnvReader): boolean => {
  const canonical = parseBooleanFlag(readEnv(AGENT_CONTROLLER_V2_FLAG))
  if (canonical !== null) return canonical

  const legacy = parseBooleanFlag(readEnv(LEGACY_AGENT_CONTROLLER_FLAG))
  if (legacy !== null) return legacy

  return false
}
