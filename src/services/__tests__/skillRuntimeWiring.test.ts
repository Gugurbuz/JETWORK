import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const implementationSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)

describe('JetWork skill runtime wiring', () => {
  it('wires skill discovery into the durable core without merging it into knowledge evidence', () => {
    expect(implementationSource).toContain("from '../_shared/skillTools.ts'")
    expect(implementationSource).toContain('ASSISTANT_SKILL_TOOLS')
    expect(implementationSource).toContain('const skillToolResultCache = new Map<string, SkillToolExecution>()')
    expect(implementationSource).toContain('toolResults: [...toolResultCache.values()]')
    expect(implementationSource).not.toContain('toolResults: [...skillToolResultCache.values()]')
  })

  it('exposes the same skill tools to OpenAI and Gemini on non-final agent rounds', () => {
    const skillPush = 'tools.push(...(ASSISTANT_SKILL_TOOLS as unknown as Array<Record<string, unknown>>))'
    expect(implementationSource.split(skillPush).length - 1).toBe(2)
    expect(implementationSource).toContain('const skillToolsEnabled = !mustSynthesize')
    expect(implementationSource).toContain('allowTools: tools.length > 0 || providerWebEnabled')
  })

  it('dispatches skill calls separately from knowledge calls and audits them as procedural-only', () => {
    expect(implementationSource).toContain("? await runSkillTool(toolName, args, 'model:skill')")
    expect(implementationSource).toContain(": await runKnowledgeTool(toolName, args, 'model:knowledge')")
    expect(implementationSource).toContain('proceduralOnly: true')
    expect(implementationSource).toContain("sourceRefs: [], status: 'completed'")
    expect(implementationSource).toContain('loadedSkills: [...loadedSkillKeys]')
  })

  it('keeps Gemini provider web capability independent from generic function tools', () => {
    expect(providerSource).toContain('allowProviderWeb?: boolean')
    expect(providerSource).toContain('const providerWebEnabled = providerNativeWebRequested || (input.allowProviderWeb ?? input.allowTools)')
    expect(providerSource).toContain("!forceNoToolSynthesis && providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER : ''")
    expect(implementationSource).toContain('allowProviderWeb: providerWebEnabled')
  })

  it('does not let skill-only Gemini tool availability trigger knowledge enumeration', () => {
    expect(providerSource).toContain("const ENUMERATION_KNOWLEDGE_TOOLS = new Set(['list_knowledge_catalog', 'list_class_inventory'])")
    expect(providerSource).toContain("const enumerationKnowledgeEnabled = input.tools.some(tool => ENUMERATION_KNOWLEDGE_TOOLS.has(String(tool.name || '')))")
    expect(providerSource).toContain('const enumerationDispatch = input.allowTools && enumerationKnowledgeEnabled')
  })

  it('keeps skill instructions explicitly non-citable in final synthesis policy', () => {
    expect(implementationSource).toContain('kurumsal gerçek, evidence veya citation olarak kullanma')
  })
})
