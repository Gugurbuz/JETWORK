import type {
  KnowledgeObjectType,
  KnowledgeRelationType,
  ParsedKnowledgeObject,
  ParsedKnowledgeRelation,
  ParsedKnowledgeSource,
} from './knowledgeParser.ts'

export const KNOWLEDGE_COMPILER_VERSION = 'jetwork-knowledge-compiler/3.0.0'

const ALLOWED_OBJECT_TYPES = new Set<KnowledgeObjectType>([
  'class','method','function','message','table','document','business_rule','interface',
  'system','component','service','api','database','queue','job','screen','decision','requirement','unknown',
])
const ALLOWED_RELATION_TYPES = new Set<KnowledgeRelationType>([
  'CONTAINS','CALLS','READS','WRITES','EMITS_MESSAGE','EXTENDS','IMPLEMENTS','DOCUMENTS',
  'DEPENDS_ON','CONNECTS_TO','EXPOSES','CONSUMES','PRODUCES','USES','OWNS','TRIGGERS','RELATES_TO',
])

const TECHNICAL_IDENTIFIER = /^(?:Z[A-Z0-9_/-]{2,}|Y[A-Z0-9_/-]{2,}|[A-Z][A-Z0-9_]{2,}-\d{3}|[A-Z][A-Z0-9_]{2,})$/u
const clean = (value: unknown, max = 8_000) => String(value ?? '').trim().slice(0, max)
const canonicalName = (value: string) => value.trim().replace(/[`'\"]/g, '').replace(/\s+/g, ' ').toUpperCase()
const canonicalIdentity = (value: string) => canonicalName(value).replace(/\s+/g, '-')
const canonicalKey = (type: KnowledgeObjectType, name: string) => `${type}:${canonicalIdentity(name)}`.toLocaleLowerCase('en-US')
const methodKey = (className: string, methodName: string) => `method:${canonicalName(className)}/${canonicalName(methodName)}`.toLocaleLowerCase('en-US')
const uniq = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map(item => [key(item), item])).values()]
const edgeEnv = (name: string) => {
  try {
    const runtime = globalThis as unknown as { Deno?: { env?: { get?: (key: string) => string | undefined } } }
    return runtime.Deno?.env?.get?.(name)
  } catch {
    return undefined
  }
}

interface SemanticEntity {
  type?: string
  name?: string
  className?: string
  aliases?: string[]
  evidence?: string
  confidence?: number
  summary?: string
}

interface SemanticRelation {
  sourceType?: string
  sourceName?: string
  sourceClassName?: string
  relationType?: string
  targetType?: string
  targetName?: string
  targetClassName?: string
  evidence?: string
  confidence?: number
}

interface SemanticExtraction {
  entities?: SemanticEntity[]
  relations?: SemanticRelation[]
  possibleConflicts?: Array<{
    canonicalKey?: string
    statement?: string
    evidence?: string
    confidence?: number
  }>
}

export interface KnowledgeCompileStats {
  semanticAttempted: boolean
  semanticAcceptedObjects: number
  semanticAcceptedRelations: number
  semanticRejectedItems: number
  materializedEndpoints: number
  reviewCandidates: number
}

export interface CompiledKnowledgeSource extends ParsedKnowledgeSource {
  compilerVersion: string
  compileStats: KnowledgeCompileStats
}

const evidenceExists = (rawText: string, evidence: string) => {
  const needle = evidence.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR')
  if (needle.length < 4) return false
  const haystack = rawText.replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
  return haystack.includes(needle)
}

const normalizedConfidence = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(1, parsed))
}

function semanticEntityKey(entity: SemanticEntity): { key: string; type: KnowledgeObjectType; name: string } | null {
  const type = clean(entity.type, 40).toLowerCase() as KnowledgeObjectType
  const name = clean(entity.name, 240)
  if (!ALLOWED_OBJECT_TYPES.has(type) || !name) return null
  if (type === 'method' && entity.className) {
    return { key: methodKey(clean(entity.className, 160), name), type, name: canonicalName(name) }
  }
  return { key: canonicalKey(type, name), type, name: TECHNICAL_IDENTIFIER.test(name.toUpperCase()) ? canonicalName(name) : name }
}

function semanticRelationEndpoint(typeValue: unknown, nameValue: unknown, classNameValue: unknown) {
  const type = clean(typeValue, 40).toLowerCase() as KnowledgeObjectType
  const name = clean(nameValue, 240)
  if (!ALLOWED_OBJECT_TYPES.has(type) || !name) return null
  return {
    type,
    name: TECHNICAL_IDENTIFIER.test(name.toUpperCase()) ? canonicalName(name) : name,
    key: type === 'method' && clean(classNameValue, 160)
      ? methodKey(clean(classNameValue, 160), name)
      : canonicalKey(type, name),
  }
}

function placeholderForCanonicalKey(key: string, evidence: string): ParsedKnowledgeObject {
  const separator = key.indexOf(':')
  const rawType = separator > 0 ? key.slice(0, separator) : 'unknown'
  const type = (ALLOWED_OBJECT_TYPES.has(rawType as KnowledgeObjectType) ? rawType : 'unknown') as KnowledgeObjectType
  const identity = separator > 0 ? key.slice(separator + 1) : key
  const name = type === 'method' ? identity.split('/').pop() || identity : identity
  const display = canonicalName(name.replace(/-/g, type === 'message' ? '-' : '_'))
  return {
    canonicalKey: key.toLocaleLowerCase('en-US'),
    objectType: type,
    name: display,
    title: display,
    summary: 'İlişki kanıtından materialize edilen bilgi nesnesi.',
    content: evidence || display,
    chunks: [{
      content: evidence || display,
      metadata: { chunkKind: 'relation_endpoint_evidence', compilerVersion: KNOWLEDGE_COMPILER_VERSION },
    }],
    metadata: {
      synthetic: true,
      syntheticReason: 'relation_endpoint',
      compilerVersion: KNOWLEDGE_COMPILER_VERSION,
    },
  }
}

async function extractSemanticKnowledge(rawText: string, fileName: string): Promise<SemanticExtraction | null> {
  const apiKey = edgeEnv('GEMINI_API_KEY')
  if (!apiKey) return null
  const maxChars = Number(edgeEnv('KNOWLEDGE_SEMANTIC_MAX_CHARS') || 80_000)
  const source = rawText.slice(0, Number.isFinite(maxChars) ? Math.max(8_000, Math.min(maxChars, 160_000)) : 80_000)
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: [
        'You are compiling enterprise knowledge into a graph. Extract only facts explicitly supported by the supplied document.',
        'Return JSON only with keys entities, relations, possibleConflicts.',
        'Every entity and relation MUST include an exact short evidence span copied from the document.',
        'Never invent technical identifiers. Preserve technical identifiers exactly.',
        'Allowed entity types: class, method, function, message, table, document, business_rule, interface, system, component, service, api, database, queue, job, screen, decision, requirement, unknown.',
        'Allowed relation types: CONTAINS, CALLS, READS, WRITES, EMITS_MESSAGE, EXTENDS, IMPLEMENTS, DOCUMENTS, DEPENDS_ON, CONNECTS_TO, EXPOSES, CONSUMES, PRODUCES, USES, OWNS, TRIGGERS, RELATES_TO.',
        'For methods include className when the class is explicitly stated.',
        'Confidence must reflect evidence clarity, not model certainty. Use >=0.95 only for explicit statements or literal technical syntax.',
        `File: ${fileName}`,
        'DOCUMENT START',
        source,
        'DOCUMENT END',
      ].join('\n') }] }],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        maxOutputTokens: 12_000,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null)
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: Record<string, unknown>) => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed as SemanticExtraction : null
  } catch {
    return null
  }
}

export async function compileKnowledgeSource(
  fileName: string,
  rawText: string,
  deterministic: ParsedKnowledgeSource,
): Promise<CompiledKnowledgeSource> {
  const stats: KnowledgeCompileStats = {
    semanticAttempted: false,
    semanticAcceptedObjects: 0,
    semanticAcceptedRelations: 0,
    semanticRejectedItems: 0,
    materializedEndpoints: 0,
    reviewCandidates: 0,
  }

  const objects = [...deterministic.objects]
  const relations = [...deterministic.relations]
  const warnings = [...deterministic.warnings]
  const shouldUseSemantic = !['abap_method_archive','error_knowledge_base','function_inventory','class_inventory'].includes(deterministic.documentType)
    || deterministic.relations.length === 0

  if (shouldUseSemantic) {
    stats.semanticAttempted = true
    const semantic = await extractSemanticKnowledge(rawText, fileName).catch(() => null)
    for (const entity of semantic?.entities || []) {
      const resolved = semanticEntityKey(entity)
      const evidence = clean(entity.evidence, 2_000)
      const confidence = normalizedConfidence(entity.confidence)
      if (!resolved || confidence < 0.72 || !evidenceExists(rawText, evidence)) {
        stats.semanticRejectedItems += 1
        continue
      }
      objects.push({
        canonicalKey: resolved.key,
        objectType: resolved.type,
        name: resolved.name,
        title: resolved.name,
        summary: clean(entity.summary, 500) || `${resolved.name} dokümandaki kanıttan çıkarılan ${resolved.type} nesnesi.`,
        content: evidence,
        chunks: [{
          content: evidence,
          metadata: { chunkKind: 'semantic_entity_evidence', confidence, compilerVersion: KNOWLEDGE_COMPILER_VERSION },
        }],
        metadata: {
          inferredFrom: 'semantic_compiler',
          aliases: Array.isArray(entity.aliases) ? entity.aliases.map(alias => clean(alias, 160)).filter(Boolean).slice(0, 12) : [],
          confidence,
          evidence,
          compilerVersion: KNOWLEDGE_COMPILER_VERSION,
        },
      })
      stats.semanticAcceptedObjects += 1
      if (confidence < 0.9) stats.reviewCandidates += 1
    }

    for (const relation of semantic?.relations || []) {
      const source = semanticRelationEndpoint(relation.sourceType, relation.sourceName, relation.sourceClassName)
      const target = semanticRelationEndpoint(relation.targetType, relation.targetName, relation.targetClassName)
      const relationType = clean(relation.relationType, 40).toUpperCase() as KnowledgeRelationType
      const evidence = clean(relation.evidence, 2_000)
      const confidence = normalizedConfidence(relation.confidence)
      if (!source || !target || !ALLOWED_RELATION_TYPES.has(relationType) || confidence < 0.78 || !evidenceExists(rawText, evidence)) {
        stats.semanticRejectedItems += 1
        continue
      }
      relations.push({
        sourceCanonicalKey: source.key,
        relationType,
        targetCanonicalKey: target.key,
        evidence,
        metadata: {
          inferredFrom: 'semantic_compiler',
          confidence,
          reviewRequired: confidence < 0.9,
          compilerVersion: KNOWLEDGE_COMPILER_VERSION,
        },
      })
      stats.semanticAcceptedRelations += 1
      if (confidence < 0.9) stats.reviewCandidates += 1
    }

    const conflicts = semantic?.possibleConflicts || []
    if (conflicts.length) {
      stats.reviewCandidates += conflicts.length
      warnings.push(`${conflicts.length} olası bilgi çelişkisi semantic compiler tarafından inceleme adayı olarak işaretlendi.`)
    }
  }

  const dedupedRelations = uniq(relations, relation => [
    relation.sourceCanonicalKey.toLocaleLowerCase('en-US'),
    relation.relationType,
    relation.targetCanonicalKey.toLocaleLowerCase('en-US'),
  ].join('|'))
  const objectMap = new Map(objects.map(object => [object.canonicalKey.toLocaleLowerCase('en-US'), object]))
  for (const relation of dedupedRelations) {
    for (const endpoint of [relation.sourceCanonicalKey, relation.targetCanonicalKey]) {
      const key = endpoint.toLocaleLowerCase('en-US')
      if (objectMap.has(key)) continue
      const placeholder = placeholderForCanonicalKey(key, clean(relation.evidence, 2_000))
      objectMap.set(key, placeholder)
      stats.materializedEndpoints += 1
    }
  }

  const finalObjects = uniq([...objectMap.values()], object => object.canonicalKey.toLocaleLowerCase('en-US'))
  return {
    ...deterministic,
    objects: finalObjects,
    relations: dedupedRelations,
    warnings: [
      ...warnings,
      ...(stats.materializedEndpoints ? [`${stats.materializedEndpoints} relation endpoint nesnesi graph bütünlüğü için materialize edildi.`] : []),
    ],
    compilerVersion: KNOWLEDGE_COMPILER_VERSION,
    compileStats: stats,
  }
}
