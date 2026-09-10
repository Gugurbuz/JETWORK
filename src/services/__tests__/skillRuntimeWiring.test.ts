import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const implementationSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
)

describe('JetWork skill runtime wiring', () => {
  it('wires skill discovery into the durable core without merging it into knowledge evidence', () => {
    expect(implementationSource).toContain("from '../_shared/skillTools.ts'")
    expect(implementationSource).toContain('ASSISTANT_SKILL_TOOLS')
    expect(implementationSource).toContain('const skillToolResultCache = new Map<string, SkillToolExecution>()')
    expect(implementationSource).toContain('const toolResultCache = new Map<string, AssistantToolExecution>()')
    expect(implementationSource).not.toContain('toolResults: [...skillToolResultCache.values()]')
  })

  it('exposes the same skill tools to OpenAI and Gemini on non-final agent rounds', () => {
    const skillPush = 'tools.push(...(ASSISTANT_SKILL_TOOLS as unknown as Array<Record<string, unknown>>))'
    expect(implementationSource.split(skillPush).length - 1).toBe(2)
    expect(implementationSource).toContain('const skillToolsEnabled = !mustSynthesize')
    expect(implementationSource).toContain('allowTools: tools.length > 0 || providerWebEnabled')
  })

  it('dispatches skill calls separately from knowledge/capability calls and audits them as procedural-only', () => {
    expect(implementationSource).toContain("? await runSkillTool(toolName, args, 'model:skill')")
    expect(implementationSource).toContain(": await runKnowledgeTool(toolName, args, 'model:capability')")
    expect(implementationSource).toContain('proceduralOnly: true')
    expect(implementationSource).toContain("sourceRefs: [], status: 'completed'")
    expect(implementationSource).toContain('loadedSkills: [...loadedSkillKeys]')
  })

  it('keeps Gemini provider web semantically independent from generic function tools while applying the public-work start gate mechanically', () => {
    expect(providerSource).toContain('allowProviderWeb?: boolean')
    expect(providerSource).toContain('const providerWebRequested = input.allowProviderWeb ?? input.allowTools')
    expect(providerSource).toContain('const publicWorkGate = gateGeminiAgentToolsForPublicWork')
    expect(providerSource).toContain('const providerWebEnabled = publicWorkGate.providerWebEnabled')
    expect(providerSource).toContain('const effectiveAllowTools = input.allowTools && (publicWorkGate.tools.length > 0 || providerWebEnabled)')
    expect(providerSource).toContain('effectiveAllowTools && providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER')
    expect(implementationSource).toContain('allowProviderWeb: providerWebEnabled')
    expect(providerSource).not.toContain('emptyMessageDetailLookup')
  })

  it('does not let skill availability trigger deterministic knowledge enumeration or semantic routing', () => {
    expect(providerSource).not.toContain('ENUMERATION_KNOWLEDGE_TOOLS')
    expect(providerSource).not.toContain('enumerationKnowledgeEnabled')
    expect(providerSource).not.toContain('buildEnumerationFastPathDispatch')
    expect(providerSource).toContain('The runtime does not decide which substantive capability to use')
    expect(providerSource).toContain('enforces the lifecycle boundary')
  })

  it('keeps skill instructions explicitly non-citable in final synthesis policy', () => {
    expect(implementationSource).toContain('kurumsal gerçek, evidence veya citation olarak kullanma')
  })
})
