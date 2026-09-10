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
const progressiveSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/progressiveDisclosure.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V5 progressive-disclosure runtime wiring', () => {
  it('keeps the existing controller session boundary while removing full canonical schemas from the provider surface', () => {
    expect(coreSource).toContain('startControllerCapabilitySession({')
    expect(coreSource).toContain('capabilitySession?.surface.tools || []')
    expect(surfaceSource).toContain("discoveryMode: 'progressive_disclosure'")
    expect(surfaceSource).toContain('CONTROLLER_LOGICAL_CAPABILITY_TOOLS')
    expect(surfaceSource).toContain('LOAD_CAPABILITY_GUIDE_TOOL')
    expect(surfaceSource).toContain('LOAD_CAPABILITY_CONTRACT_TOOL')
    expect(surfaceSource).toContain('INVOKE_CAPABILITY_TOOL')
    expect(progressiveSource).toContain('Layer-2 usage guidance')
    expect(progressiveSource).toContain('Layer-3 exact canonical invocation contracts')
  })

  it('does not resurrect semantic Top-K or runtime routing', () => {
    expect(surfaceSource).not.toContain('discoverIndexedCapabilities')
    expect(surfaceSource).not.toContain('selectedTools.push(DISCOVER_MORE_CAPABILITIES_TOOL)')
    expect(surfaceSource).not.toContain('pendingCandidateKeys')
    expect(progressiveSource).not.toContain('intentRouter')
    expect(progressiveSource).not.toContain('keyword route')
  })

  it('preserves provider-native web as a separate model-visible primitive', () => {
    expect(surfaceSource).toContain('providerWebVisible: true')
    expect(coreSource).toContain('capabilitySession?.surface.providerWebVisible === true')
    expect(coreSource).not.toContain("AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none'")
  })

  it('keeps the actual capability decision with the active controller', () => {
    expect(surfaceSource).toContain('active Controller still sees every logical option')
    expect(surfaceSource).toContain('Runtime capability, sorgu veya sonraki adımı seçmez')
    expect(progressiveSource).toContain('Exact schema yüklenmiş olması çağrı zorunluluğu değildir')
  })
})
