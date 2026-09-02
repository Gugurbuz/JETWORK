import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('Agent Controller V2 Top-K runtime wiring', () => {
  it('starts semantic discovery and uses the session surface for agentic provider tools', () => {
    expect(source).toContain('startControllerCapabilitySession({')
    expect(source).toContain('query: currentUserContent')
    expect(source).toContain('capabilitySession?.surface.tools || []')
    expect(source).toContain('CAPABILITY_CANDIDATES:')
  })

  it('keeps discover-more controller-selected and candidate-only', () => {
    expect(source).toContain("toolName === DISCOVER_MORE_CAPABILITIES_TOOL_NAME")
    expect(source).toContain('await runCapabilityDiscoveryTool(args)')
    expect(source).toContain('candidateOnly: true')
    expect(source).toContain('CAPABILITY_SURFACE_UPDATED:')
  })

  it('does not globally enable provider web in agentic mode', () => {
    expect(source).toContain("capabilitySession?.surface.providerWebVisible === true")
    expect(source).toContain("&& !AGENTIC_CONTROLLER_ENABLED")
    expect(source).not.toContain("AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none'")
  })

  it('keeps the all-tools arrays on the legacy branch only', () => {
    expect(source).toContain('if (AGENTIC_CONTROLLER_ENABLED) {\n                tools.push(...(agenticVisibleTools')
    expect(source).toContain('if (skillToolsEnabled) tools.push(...(ASSISTANT_SKILL_TOOLS')
    expect(source).toContain('if (knowledgeToolsEnabled) tools.push(...(ASSISTANT_KNOWLEDGE_TOOLS')
  })
})
