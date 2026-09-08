export const AGENT_CONTROLLER_V2_FLAG = 'AGENT_CONTROLLER_V2'
export const LEGACY_AGENT_CONTROLLER_FLAG = 'ASSISTANT_AGENTIC_CONTROLLER'
export const DENO_DEPLOYMENT_ID_ENV = 'DENO_DEPLOYMENT_ID'

// Existing JETWORK Edge Functions reserved for non-production Agentic Runtime
// validation. These UUIDs are Supabase function identities, not user-controlled
// request data.
export const AGENT_CONTROLLER_V2_CANARY_FUNCTION_IDS = new Set([
  '8889f9e7-b72b-4549-b793-0045311043d6', // openai-assistant-golden-canary
  '7806a5b9-17a7-4cae-a15e-c3e2d6ec8eac', // assistant-primary-agent-core-canary
  '83401d13-c940-4530-a4c9-fc0b9be60940', // agent-work-core-v3-canary
])

// Production rollout is code-owned and function-identity scoped. Request data,
// headers, workspace/user content and the legacy flag cannot opt a deployment in.
// Rollback is one code/deploy change: remove the production identity or deploy a
// prior gateway version.
export const AGENT_CONTROLLER_V2_PRODUCTION_FUNCTION_IDS = new Set([
  '0f38ecb0-e3c9-4adb-8aec-a52c3474d266', // openai-assistant-v2
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

const deploymentMatches = (deploymentId: string | undefined, functionIds: Set<string>) => {
  const normalized = String(deploymentId || '').trim()
  if (!normalized) return false
  return [...functionIds].some(functionId => normalized.includes(`_${functionId}_`))
}

const isExplicitAgenticCanaryDeployment = (deploymentId: string | undefined) => (
  deploymentMatches(deploymentId, AGENT_CONTROLLER_V2_CANARY_FUNCTION_IDS)
)

const isExplicitAgenticProductionDeployment = (deploymentId: string | undefined) => (
  deploymentMatches(deploymentId, AGENT_CONTROLLER_V2_PRODUCTION_FUNCTION_IDS)
)

/**
 * Canonical Agentic Runtime rollout decision.
 *
 * The canonical environment flag can enable a normal deployment. In addition,
 * explicitly code-owned Supabase canary and production function identities are
 * rollout authorities. Missing/invalid configuration remains OFF everywhere else,
 * even if the legacy flag is true. No request header/body/user input participates.
 */
export const isAgentControllerV2Enabled = (readEnv: EnvReader = defaultEnvReader): boolean => {
  if (parseBooleanFlag(readEnv(AGENT_CONTROLLER_V2_FLAG)) === true) return true
  const deploymentId = readEnv(DENO_DEPLOYMENT_ID_ENV)
  return isExplicitAgenticCanaryDeployment(deploymentId)
    || isExplicitAgenticProductionDeployment(deploymentId)
}

/**
 * Transitional visibility for the pre-V2 runtime flag. This does not enable V2;
 * callers may use it only while removing legacy branches and telemetry labels.
 */
export const isLegacyAgentControllerEnabled = (readEnv: EnvReader = defaultEnvReader): boolean => (
  parseBooleanFlag(readEnv(LEGACY_AGENT_CONTROLLER_FLAG)) === true
)
