import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const surfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V3 full-surface runtime wiring', () => {
  it('keeps the existing session call boundary but removes semantic Top-K selection from that boundary', () => {
    expect(coreSource).toContain('startControllerCapabilitySession({')
    expect(coreSource).toContain('capabilitySession?.surface.tools || []')
    expect(surfaceSource).not.toContain('discoverIndexedCapabilities')
    expect(surfaceSource).toContain("discoveryMode: 'full_surface'")
    expect(surfaceSource).toContain('...runtimeTools')
  })

  it('does not expose discover-more because the full registered surface is already visible', () => {
    expect(surfaceSource).toContain("DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'")
    expect(surfaceSource).toContain('deliberately not included in the model-visible surface')
    expect(surfaceSource).not.toContain('selectedTools.push(DISCOVER_MORE_CAPABILITIES_TOOL)')
  })

  it('enables provider-native web as a model-visible capability rather than a semantic route', () => {
    expect(surfaceSource).toContain('providerWebVisible: true')
    expect(coreSource).toContain('capabilitySession?.surface.providerWebVisible === true')
    expect(coreSource).not.toContain("AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none'")
  })

  it('contains no mandatory next-tool guidance in the controller surface', () => {
    expect(surfaceSource).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(surfaceSource).not.toContain('next knowledge call MUST')
    expect(surfaceSource).not.toContain('pendingCandidateKeys')
  })
})
