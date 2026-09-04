import { ASSISTANT_KNOWLEDGE_TOOLS } from '../assistantTools.ts'
import { ASSISTANT_ARTIFACT_TOOLS } from '../artifactExecutionTools.ts'
import { ASSISTANT_EXECUTION_TOOLS } from '../executionTools.ts'
import { ASSISTANT_CONTEXT_TOOLS } from '../contextTools.ts'
import { getCapabilityRuntimeStatus } from '../capabilityManifest.ts'
import { JETWORK_SKILLS, type JetWorkSkillRecord } from '../skillRegistry.generated.ts'
import { JETWORK_V2_SKILLS } from '../skillRegistry.v2.ts'

export const CAPABILITY_REGISTRY_VERSION = 'capability-registry-v2'

export type CapabilityCategory = 'skill' | 'knowledge' | 'artifact' | 'web' | 'context'
export type CapabilityKind = 'skill' | 'tool' | 'provider_capability'

export interface RuntimeToolSchema {
  type?: string
  name: string
  description?: string
  strict?: boolean
  parameters?: Record<string, unknown>
}

export interface CapabilityRegistryItem {
  id: string
  version: string
  kind: CapabilityKind
  category: CapabilityCategory
  title: string
  description: string
  semanticText: string
  toolName?: string
  skillKey?: string
  schema?: RuntimeToolSchema
  metadata: Record<string, unknown>
}

const compact = (value: unknown, max = 8_000) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

const runtimeSkills = () => {
  const merged = new Map<string, JetWorkSkillRecord>()
  for (const skill of JETWORK_V2_SKILLS) merged.set(skill.key, skill as JetWorkSkillRecord)
  for (const skill of JETWORK_SKILLS) merged.set(skill.key, skill)
  return [...merged.values()]
}

const skillItem = (skill: JetWorkSkillRecord): CapabilityRegistryItem => {
  const runtime = getCapabilityRuntimeStatus(skill.key)
  return {
    id: `skill:${skill.key}`,
    version: String((skill as { version?: unknown }).version || '1'),
    kind: 'skill',
    category: 'skill',
    title: skill.title,
    description: skill.description,
    skillKey: skill.key,
    semanticText: compact([
      skill.key,
      skill.title,
      skill.category,
      skill.description,
      ...(skill.aliases || []),
      ...(skill.tools || []),
      ...runtime.executorTools,
      String(skill.markdown || '').slice(0, 6_000),
    ].join('\n')),
    metadata: {
      category: skill.category,
      priority: skill.priority,
      aliases: skill.aliases || [],
      declaredTools: skill.tools || [],
      executorTools: runtime.executorTools,
      readiness: runtime.readiness,
      executionMode: runtime.mode,
    },
  }
}

const toolItem = (
  tool: RuntimeToolSchema,
  category: CapabilityCategory,
  metadata: Record<string, unknown> = {},
): CapabilityRegistryItem => ({
  id: `tool:${tool.name}`,
  version: '1',
  kind: 'tool',
  category,
  title: tool.name,
  description: compact(tool.description, 2_000),
  semanticText: compact([
    tool.name,
    tool.description,
    JSON.stringify(tool.parameters || {}),
  ].join('\n')),
  toolName: tool.name,
  schema: tool,
  metadata,
})

const WEB_CAPABILITY: CapabilityRegistryItem = {
  id: 'provider:web_search',
  version: '1',
  kind: 'provider_capability',
  category: 'web',
  title: 'Provider web research',
  description: 'Search current public web sources when external, recent, regulatory, vendor or public technical verification is useful.',
  semanticText: 'web research current public sources recent regulation legislation vendor documentation public technical verification internet search',
  toolName: 'provider_web',
  metadata: { nativeProviderCapability: true },
}

const toolNameSet = (tools: readonly RuntimeToolSchema[]) => new Set(tools.map(tool => tool.name))

export const buildCapabilityRegistry = (): readonly CapabilityRegistryItem[] => {
  const items = new Map<string, CapabilityRegistryItem>()

  for (const skill of runtimeSkills()) items.set(`skill:${skill.key}`, skillItem(skill))

  for (const tool of ASSISTANT_KNOWLEDGE_TOOLS as unknown as readonly RuntimeToolSchema[]) {
    items.set(`tool:${tool.name}`, toolItem(tool, 'knowledge', { evidenceCapability: true }))
  }

  for (const tool of ASSISTANT_CONTEXT_TOOLS as unknown as readonly RuntimeToolSchema[]) {
    items.set(`tool:${tool.name}`, toolItem(tool, 'context', {
      contextCapability: true,
      durableMemoryCapability: tool.name === 'record_project_memory',
      requiresUserProvenance: true,
    }))
  }

  const artifactNames = toolNameSet(ASSISTANT_ARTIFACT_TOOLS as unknown as readonly RuntimeToolSchema[])
  for (const tool of ASSISTANT_ARTIFACT_TOOLS as unknown as readonly RuntimeToolSchema[]) {
    items.set(`tool:${tool.name}`, toolItem(tool, tool.name.includes('attachment') ? 'context' : 'artifact', {
      executionCapability: tool.name !== 'load_document_contract',
      contractCapability: tool.name === 'load_document_contract',
    }))
  }

  for (const tool of ASSISTANT_EXECUTION_TOOLS as unknown as readonly RuntimeToolSchema[]) {
    if (artifactNames.has(tool.name)) continue
    items.set(`tool:${tool.name}`, toolItem(tool, 'artifact', { executionCapability: true }))
  }

  items.set(WEB_CAPABILITY.id, WEB_CAPABILITY)
  return [...items.values()]
}

export const CAPABILITY_REGISTRY = buildCapabilityRegistry()

export const capabilityById = (id: string) => CAPABILITY_REGISTRY.find(item => item.id === id) || null
