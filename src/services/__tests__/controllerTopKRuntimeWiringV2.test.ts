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

describe('Agent Controller V5.3 JIT semantic discovery runtime wiring', () => {
  it('keeps the existing session boundary while making Top-K model-authored and lazy', () => {
    expect(coreSource).toContain('startControllerCapabilitySession({')
    expect(coreSource).toContain('capabilitySession?.surface.tools || []')
    expect(surfaceSource).toContain('discoverIndexedCapabilities')
    expect(surfaceSource).toContain("discoveryMode: 'semantic_action_batch'")
    expect(surfaceSource).toContain('surfaceWithActivated')
    expect(surfaceSource).toContain('logicalToolNames')
  })

  it('uses the discover-more boundary for semantic candidates plus optional index/guide/contract activation', () => {
    expect(surfaceSource).toContain("DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'")
    expect(surfaceSource).toContain("query.toLocaleLowerCase('en-US') === 'index'")
    expect(surfaceSource).toContain("query.match(/^guide")
    expect(surfaceSource).toContain("query.match(/^contract")
    expect(surfaceSource).toContain("layer: 'semantic'")
    expect(surfaceSource).toContain('guidedToolNames')
    expect(surfaceSource).toContain('activatedToolNames')
  })

  it('routes web through the same progressive disclosure path instead of bypassing it with native provider web', () => {
    expect(surfaceSource).toContain('providerWebVisible: false')
    expect(coreSource).toContain('capabilitySession?.surface.providerWebVisible === true')
    expect(coreSource).not.toContain("AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none'")
  })

  it('contains no mandatory next-tool guidance in the controller surface', () => {
    expect(surfaceSource).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(surfaceSource).not.toContain('next knowledge call MUST')
    expect(surfaceSource).not.toContain('pendingCandidateKeys')
    expect(surfaceSource).toContain('Runtime only validates name/schema/permission/budget')
  })
})
