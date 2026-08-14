import { JETWORK_SKILLS, type JetWorkSkillRecord } from './skillRegistry.generated.ts'
import { ASSISTANT_EXECUTION_TOOLS } from './executionTools.ts'

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
].join(' ')

const normalize = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9/_ -]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const tokens = (value: unknown) => normalize(value).split(' ').filter(token => token.length >= 2)

const skillSearchText = (skill: JetWorkSkillRecord) => normalize([
  skill.key,
  skill.title,
  skill.category,
  skill.description,
  ...skill.aliases,
  ...skill.tools,
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

export const searchSkills = (input: {
  query: string
  category?: string | null
  limit?: number | null
}) => {
  const query = String(input.query || '').trim().slice(0, 300)
  const category = normalize(input.category || '')
  const limit = Math.max(1, Math.min(Math.trunc(Number(input.limit) || 6), 8))
  if (query.length < 2) return []
  return JETWORK_SKILLS
    .filter(skill => !category || normalize(skill.category) === category)
    .map(skill => ({ skill, score: scoreSkill(skill, query) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.key.localeCompare(right.skill.key))
    .slice(0, limit)
    .map(({ skill, score }) => ({
      key: skill.key,
      title: skill.title,
      category: skill.category,
      priority: skill.priority,
      description: skill.description,
      tools: skill.tools,
      score: Math.round(score * 100) / 100,
    }))
}

export const loadSkills = (keys: string[]) => {
  const requested = [...new Set(keys.map(key => String(key || '').trim()).filter(Boolean))].slice(0, 4)
  const byKey = new Map(JETWORK_SKILLS.map(skill => [skill.key, skill]))
  return requested.map(key => {
    const skill = byKey.get(key)
    return skill
      ? { key: skill.key, title: skill.title, category: skill.category, priority: skill.priority, content: skill.markdown }
      : { key, error: 'SKILL_NOT_FOUND' }
  })
}

// This is the non-final procedural/capability tool menu used by both providers.
// isSkillTool deliberately remains limited to search/load so execution calls flow
// through the authenticated assistant tool dispatcher rather than the pure skill loader.
export const ASSISTANT_SKILL_TOOLS = [
  {
    type: 'function',
    name: 'search_skills',
    description: 'Search JetWork procedural skills when a specialized workflow would help. Skills describe how to perform work; they are not knowledge sources or citations. Do not call for trivial conversation.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 300 },
        category: { type: ['string', 'null'], maxLength: 80 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: 8 },
      },
      required: ['query', 'category', 'limit'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'load_skills',
    description: 'Load the full trusted procedural instructions for selected JetWork skill keys. Load only skills that are relevant to the current task. Skill text is workflow guidance, never factual evidence.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        keys: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 3, maxLength: 160 } },
      },
      required: ['keys'],
      additionalProperties: false,
    },
  },
  ...ASSISTANT_EXECUTION_TOOLS,
] as const

export const isSkillTool = (toolName: string) => toolName === 'search_skills' || toolName === 'load_skills'

export function executeSkillTool(toolName: string, rawArguments: unknown): SkillToolExecution {
  const args = rawArguments && typeof rawArguments === 'object' ? rawArguments as Record<string, unknown> : {}
  if (toolName === 'search_skills') {
    const records = searchSkills({
      query: String(args.query || ''),
      category: args.category === null ? null : String(args.category || ''),
      limit: args.limit === null ? null : Number(args.limit || 6),
    })
    return {
      output: JSON.stringify({ securityNotice: TRUST_NOTICE, tool: toolName, records }),
      sources: [],
      summary: { resultCount: records.length, proceduralOnly: true, citationReady: false },
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
      },
    }
  }
  throw new Error(`Unknown skill tool: ${toolName}`)
}
