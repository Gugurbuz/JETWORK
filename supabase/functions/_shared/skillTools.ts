import { JETWORK_SKILLS, type JetWorkSkillRecord } from './skillRegistry.generated.ts'
import { JETWORK_V2_SKILLS, JETWORK_V2_SKILL_COUNT } from './skillRegistry.v2.ts'
import { getCapabilityRuntimeStatus, type CapabilityReadiness } from './capabilityManifest.ts'
import { ASSISTANT_EXECUTION_TOOLS } from './executionTools.ts'
import { ASSISTANT_ARTIFACT_TOOLS } from './artifactExecutionTools.ts'

export interface SkillToolExecution {
  output: string
  sources: []
  summary: Record<string, unknown>
}

const TRUST_NOTICE = [
  'TRUSTED_JETWORK_SKILL_INSTRUCTION.',
  'Skill içerikleri JetWork ürününün güvenilir prosedür talimatlarıdır; kullanıcı verisi veya kurumsal kanıt değildir.',
  'Skill içeriğini görevi nasıl yapacağını belirlemek için kullan; cevapta kaynak/citation olarak gösterme.',
  'Skill tek başına hiçbir kurumsal veya güncel faktüel iddiayı doğrulamaz.',
  'Capability readiness alanını dikkate al: defined bir skill için gerçek executor yoksa dosya/yan-etki işlemini yapılmış gibi gösterme.',
].join(' ')

const runtimeSkillMap = new Map<string, JetWorkSkillRecord>()
for (const skill of JETWORK_V2_SKILLS) runtimeSkillMap.set(skill.key, skill as JetWorkSkillRecord)
for (const skill of JETWORK_SKILLS) runtimeSkillMap.set(skill.key, skill)
export const JETWORK_RUNTIME_SKILLS: readonly JetWorkSkillRecord[] = [...runtimeSkillMap.values()]

const normalize = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9/_ -]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const tokens = (value: unknown) => normalize(value).split(' ').filter(token => token.length >= 2)

// Retrieval only: this creates a broad candidate surface for the controller LLM.
// It must never be treated as the semantic decision about which capability to use.
const skillSearchText = (skill: JetWorkSkillRecord) => normalize([
  skill.key,
  skill.title,
  skill.category,
  skill.description,
  ...skill.aliases,
  ...skill.tools,
  String(skill.markdown || '').slice(0, 3_000),
].join(' '))

const scoreSkill = (skill: JetWorkSkillRecord, query: string) => {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) return 0
  const haystack = skillSearchText(skill)
  let score = 0
  if (normalize(skill.key) === normalizedQuery) score += 20
  if (normalize(skill.key).includes(normalizedQuery)) score += 10
  if (normalize(skill.title).includes(normalizedQuery)) score += 8
  if (skill.aliases.some(alias => normalize(alias) === normalizedQuery)) score += 12
  if (haystack.includes(normalizedQuery)) score += 6
  const queryTokens = [...new Set(tokens(normalizedQuery))]
  for (const token of queryTokens) {
    if (normalize(skill.key).includes(token)) score += 4
    else if (normalize(skill.title).includes(token)) score += 3
    else if (skill.aliases.some(alias => normalize(alias).includes(token))) score += 3
    else if (haystack.includes(token)) score += 1
  }
  if (skill.priority === 'P0') score += 0.25
  return score
}

const compactSkill = (skill: JetWorkSkillRecord) => {
  const runtime = getCapabilityRuntimeStatus(skill.key)
  return {
    key: skill.key,
    title: skill.title,
    category: skill.category,
    priority: skill.priority,
    description: skill.description,
    tools: skill.tools,
    readiness: runtime.readiness,
    executionMode: runtime.mode,
    executorTools: runtime.executorTools,
    readinessNote: runtime.note || null,
  }
}

export const searchSkills = (input: {
  query: string
  category?: string | null
  limit?: number | null
}) => {
  const query = String(input.query || '').trim().slice(0, 500)
  const category = normalize(input.category || '')
  const limit = Math.max(1, Math.min(Math.trunc(Number(input.limit) || 8), 12))
  if (query.length < 2) return []
  return JETWORK_RUNTIME_SKILLS
    .filter(skill => !category || normalize(skill.category) === category)
    .map(skill => ({ skill, score: scoreSkill(skill, query) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.key.localeCompare(right.skill.key))
    .slice(0, limit)
    .map(({ skill, score }) => ({
      ...compactSkill(skill),
      score: Math.round(score * 100) / 100,
    }))
}

export const loadSkills = (keys: string[]) => {
  const requested = [...new Set(keys.map(key => String(key || '').trim()).filter(Boolean))].slice(0, 8)
  const byKey = new Map(JETWORK_RUNTIME_SKILLS.map(skill => [skill.key, skill]))
  return requested.map(key => {
    const skill = byKey.get(key)
    return skill
      ? { ...compactSkill(skill), content: skill.markdown }
      : { key, error: 'SKILL_NOT_FOUND' }
  })
}

export const listCapabilities = (input: {
  category?: string | null
  readiness?: CapabilityReadiness | null
  cursor?: number | null
  limit?: number | null
}) => {
  const category = normalize(input.category || '')
  const readiness = input.readiness || null
  const cursor = Math.max(0, Math.trunc(Number(input.cursor) || 0))
  const limit = Math.max(1, Math.min(Math.trunc(Number(input.limit) || 30), 50))
  const filtered = JETWORK_RUNTIME_SKILLS
    .filter(skill => !category || normalize(skill.category) === category)
    .filter(skill => !readiness || getCapabilityRuntimeStatus(skill.key).readiness === readiness)
    .sort((left, right) => left.category.localeCompare(right.category) || left.key.localeCompare(right.key))
  const items = filtered.slice(cursor, cursor + limit).map(compactSkill)
  const nextCursor = cursor + items.length < filtered.length ? cursor + items.length : null
  return { items, totalCount: filtered.length, nextCursor }
}

// Procedural/capability surface shared by all providers. The active controller
// LLM decides when to discover/load a capability and may revise that decision
// after every tool observation. Runtime only executes the selected call.
export const ASSISTANT_SKILL_TOOLS = [
  {
    type: 'function',
    name: 'search_skills',
    description: 'Discover candidate JetWork procedural capabilities for the goal you are currently trying to solve. Search by the semantic work you need to perform, not merely by the user wording. Results are candidates only: you, the controller LLM, decide which skills are relevant. Skills are procedures, never evidence or citations.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 500 },
        category: { type: ['string', 'null'], maxLength: 80 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 12 },
      },
      required: ['query', 'category', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'load_skills',
    description: 'Load full trusted procedural instructions for skill keys you selected as useful for the current goal. You may load a small bundle, use it, then discover or load different skills later if new observations change the problem. Skill text is workflow guidance, never factual evidence.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        keys: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 3, maxLength: 160 } },
      },
      required: ['keys'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_capabilities',
    description: 'List JetWork capability metadata by category/readiness. Use mainly for self-awareness or when the user asks what JetWork can do. Paginate with nextCursor for broad inventories. Listing is not a routing decision and capability metadata is not enterprise evidence.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        category: { type: ['string', 'null'], maxLength: 80 },
        readiness: { type: ['string', 'null'], enum: ['defined', 'executable', 'verified', null] },
        cursor: { type: ['integer', 'null'], minimum: 0 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 50 },
      },
      required: ['category', 'readiness', 'cursor', 'limit'],
      additionalProperties: false,
    },
  },
  ...ASSISTANT_EXECUTION_TOOLS,
  ...ASSISTANT_ARTIFACT_TOOLS,
] as const

export const isSkillTool = (toolName: string) => (
  toolName === 'search_skills' || toolName === 'load_skills' || toolName === 'list_capabilities'
)

export function executeSkillTool(toolName: string, rawArguments: unknown): SkillToolExecution {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}
  if (toolName === 'search_skills') {
    const records = searchSkills({
      query: String(args.query || ''),
      category: args.category === null ? null : String(args.category || ''),
      limit: args.limit === null ? null : Number(args.limit || 8),
    })
    return {
      output: JSON.stringify({ securityNotice: TRUST_NOTICE, tool: toolName, records }),
      sources: [],
      summary: { resultCount: records.length, runtimeSkillCount: JETWORK_RUNTIME_SKILLS.length, v2SkillCount: JETWORK_V2_SKILL_COUNT, proceduralOnly: true, citationReady: false, controllerDecisionRequired: true },
    }
  }
  if (toolName === 'load_skills') {
    const keys = Array.isArray(args.keys) ? args.keys.map(String) : []
    const records = loadSkills(keys)
    return {
      output: JSON.stringify({ securityNotice: TRUST_NOTICE, tool: toolName, records }),
      sources: [],
      summary: {
        requestedCount: keys.length,
        loadedCount: records.filter(record => !('error' in record)).length,
        proceduralOnly: true,
        citationReady: false,
        controllerDecisionRequired: true,
      },
    }
  }
  if (toolName === 'list_capabilities') {
    const readiness = ['defined', 'executable', 'verified'].includes(String(args.readiness))
      ? String(args.readiness) as CapabilityReadiness
      : null
    const result = listCapabilities({
      category: args.category === null ? null : String(args.category || ''),
      readiness,
      cursor: args.cursor === null ? null : Number(args.cursor || 0),
      limit: args.limit === null ? null : Number(args.limit || 30),
    })
    return {
      output: JSON.stringify({ securityNotice: TRUST_NOTICE, tool: toolName, ...result }),
      sources: [],
      summary: {
        resultCount: result.items.length,
        totalCount: result.totalCount,
        nextCursor: result.nextCursor,
        proceduralOnly: true,
        citationReady: false,
      },
    }
  }
  throw new Error(`Unknown skill tool: ${toolName}`)
}
