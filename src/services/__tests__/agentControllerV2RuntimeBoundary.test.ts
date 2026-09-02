import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTROLLER_V2_FLAG,
  LEGACY_AGENT_CONTROLLER_FLAG,
  isAgentControllerV2Enabled,
  isLegacyAgentControllerEnabled,
} from '../../../supabase/functions/_shared/runtime/runtimeFlags.ts'
import { buildAuthoritativeInventoryFastPlan } from '../../../supabase/functions/_shared/authoritativeInventoryFastPath.ts'

describe('Agent Controller V2 runtime boundary', () => {
  it('defaults to disabled when rollout configuration is missing', () => {
    expect(isAgentControllerV2Enabled(() => undefined)).toBe(false)
  })

  it('uses only the canonical rollout flag to enable Controller V2', () => {
    const canonical = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'true'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'false'],
    ])
    expect(isAgentControllerV2Enabled(name => canonical.get(name))).toBe(true)

    const legacyOnly = new Map<string, string>([[LEGACY_AGENT_CONTROLLER_FLAG, 'true']])
    expect(isAgentControllerV2Enabled(name => legacyOnly.get(name))).toBe(false)
    expect(isLegacyAgentControllerEnabled(name => legacyOnly.get(name))).toBe(true)
  })

  it('treats invalid canonical configuration as disabled', () => {
    const values = new Map<string, string>([
      [AGENT_CONTROLLER_V2_FLAG, 'maybe'],
      [LEGACY_AGENT_CONTROLLER_FLAG, 'true'],
    ])
    expect(isAgentControllerV2Enabled(name => values.get(name))).toBe(false)
  })

  it('does not allow the authoritative inventory fast path to bypass an active controller', () => {
    expect(buildAuthoritativeInventoryFastPlan('hangi classlar var', {
      agentControllerV2Enabled: true,
    })).toBeNull()
  })

  it('keeps the inventory path available only for the legacy runtime during migration', () => {
    const plan = buildAuthoritativeInventoryFastPlan('hangi classlar var', {
      agentControllerV2Enabled: false,
    })
    expect(plan?.enumerationTarget?.tool).toBe('list_class_inventory')
  })
})
