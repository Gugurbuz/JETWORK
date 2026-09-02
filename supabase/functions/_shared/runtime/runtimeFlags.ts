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
 * Production-safe invariant: only AGENT_CONTROLLER_V2 may enable Controller V2.
 * Missing or invalid canonical configuration means OFF even if a legacy runtime
 * flag is still enabled in the environment. This prevents an old setting from
 * accidentally promoting the new architecture into production.
 */
export const isAgentControllerV2Enabled = (readEnv: EnvReader = defaultEnvReader): boolean => (
  parseBooleanFlag(readEnv(AGENT_CONTROLLER_V2_FLAG)) === true
)

/**
 * Transitional visibility for the pre-V2 runtime flag. This does not enable V2;
 * callers may use it only while removing legacy branches and telemetry labels.
 */
export const isLegacyAgentControllerEnabled = (readEnv: EnvReader = defaultEnvReader): boolean => (
  parseBooleanFlag(readEnv(LEGACY_AGENT_CONTROLLER_FLAG)) === true
)
