export const AGENT_CONTROLLER_V2_FLAG = 'AGENT_CONTROLLER_V2'
export const LEGACY_AGENT_CONTROLLER_FLAG = 'ASSISTANT_AGENTIC_CONTROLLER'
export const DENO_DEPLOYMENT_ID_ENV = 'DENO_DEPLOYMENT_ID'

// Existing JETWORK Edge Functions reserved for non-production Agentic Runtime
// validation. These UUIDs are Supabase function identities, not user-controlled
// request data. Production assistant function IDs are deliberately absent.
export const AGENT_CONTROLLER_V2_CANARY_FUNCTION_IDS = new Set([
  '8889f9e7-b72b-4549-b793-0045311043d6', // openai-assistant-golden-canary
  '7806a5b9-17a7-4cae-a15e-c3e2d6ec8eac', // assistant-primary-agent-core-canary
])

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

const isExplicitAgenticCanaryDeployment = (deploymentId: string | undefined) => {
  const normalized = String(deploymentId || '').trim()
  if (!normalized) return false
  return [...AGENT_CONTROLLER_V2_CANARY_FUNCTION_IDS].some(functionId => normalized.includes(`_${functionId}_`))
}

/**
 * Canonical Agentic Runtime rollout decision.
 *
 * Normal production deployments can only be enabled by AGENT_CONTROLLER_V2.
 * Missing/invalid canonical configuration remains OFF even if the legacy flag is
 * true. The only additional enable path is an explicit, code-owned Supabase
 * canary function identity used for P6/P7 live-like validation. No request
 * header/body/user input participates in this decision.
 */
export const isAgentControllerV2Enabled = (readEnv: EnvReader = defaultEnvReader): boolean => {
  if (parseBooleanFlag(readEnv(AGENT_CONTROLLER_V2_FLAG)) === true) return true
  return isExplicitAgenticCanaryDeployment(readEnv(DENO_DEPLOYMENT_ID_ENV))
}

/**
 * Transitional visibility for the pre-V2 runtime flag. This does not enable V2;
 * callers may use it only while removing legacy branches and telemetry labels.
 */
export const isLegacyAgentControllerEnabled = (readEnv: EnvReader = defaultEnvReader): boolean => (
  parseBooleanFlag(readEnv(LEGACY_AGENT_CONTROLLER_FLAG)) === true
)
