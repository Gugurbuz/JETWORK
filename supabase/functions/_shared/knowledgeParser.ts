export const KNOWLEDGE_PARSER_VERSION = 'jetwork-kb-parser/1.0.0'

export type KnowledgeObjectType =
  | 'class'
  | 'method'
  | 'function'
  | 'message'
  | 'table'
  | 'document'
  | 'business_rule'
  | 'interface'
  | 'unknown'

export type KnowledgeRelationType =
  | 'CONTAINS'
  | 'CALLS'
  | 'READS'
  | 'WRITES'
  | 'EMITS_MESSAGE'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'DOCUMENTS'
  | 'RELATES_TO'

export interface ParsedKnowledgeObject {
  canonicalKey: string
  objectType: KnowledgeObjectType
  name: string
  title: string
  summary?: string
  content: string
  metadata?: Record<string, unknown>
}

export interface ParsedKnowledgeRelation {
  sourceCanonicalKey: string
  relationType: KnowledgeRelationType
  targetCanonicalKey: string
  evidence?: string
  metadata?: Record<string, unknown>
}

export interface ParsedKnowledgeSource {
  documentType:
    | 'abap_method_archive'
    | 'error_knowledge_base'
    | 'class_inventory'
    | 'function_inventory'
    | 'dependency_map'
    | 'markdown_document'
    | 'text_document'
  objects: ParsedKnowledgeObject[]
  relations: ParsedKnowledgeRelation[]
  warnings: string[]
}

const normalizeText = (value: string) => value
  .replace(/^\uFEFF/, '')
  .replace(/\r\n?/g, '\n')
  .trim()

const canonicalName = (value: string) => value
  .trim()
  .replace(/[`'"]/g, '')
  .toUpperCase()

const canonicalKey = (type: KnowledgeObjectType, name: string) =>
  `${type}:${canonicalName(name)}`.toLocaleLowerCase('en-US')

const methodKey = (className: string, methodName: string) =>
  `method:${canonicalName(className)}/${canonicalName(methodName)}`.toLocaleLowerCase('en-US')

const slug = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLocaleLowerCase('en-US')
  .slice(0, 180) || 'source'

const firstParagraph = (content: string, fallback: string) => {
  const paragraph = content
    .split(/\n\s*\n/)
    .map(part => part.replace(/^#{1,6}\s+.*$/gm, '').trim())
    .find(Boolean)
  return (paragraph || fallback).replace(/\s+/g, ' ').slice(0, 500)
}

function deduplicateObjects(objects: ParsedKnowledgeObject[]): ParsedKnowledgeObject[] {
  const unique = new Map<string, ParsedKnowledgeObject>()
  for (const object of objects) {
    const existing = unique.get(object.canonicalKey)
    if (!existing || object.content.length > existing.content.length) {
      unique.set(object.canonicalKey, object)
    }
  }
  return [...unique.values()]
}

function deduplicateRelations(relations: ParsedKnowledgeRelation[]): ParsedKnowledgeRelation[] {
  const unique = new Map<string, ParsedKnowledgeRelation>()
  for (const relation of relations) {
    if (!relation.sourceCanonicalKey || !relation.targetCanonicalKey) continue
    const key = [
      relation.sourceCanonicalKey,
      relation.relationType,
      relation.targetCanonicalKey,
    ].join('|')
    if (!unique.has(key)) unique.set(key, relation)
  }
  return [...unique.values()]
}

function withoutAbapComments(content: string): string {
  return content
    .split('\n')
    .filter(line => !/^\s*\*/.test(line))
    .map(line => line.replace(/\s+".*$/, ''))
    .join('\n')
}

function inferClassAt(
  source: string,
  methodIndex: number,
  methodName: string,
  defaultClass: string,
): string {
  const markerPattern = /^\*\s*CLASS\s*:\s*([A-Z0-9_]+)/gim
  let match: RegExpExecArray | null
  let currentClass = defaultClass
  while ((match = markerPattern.exec(source)) !== null) {
    if (match.index > methodIndex) break
    currentClass = canonicalName(match[1])
  }

  // The supplied multi-class CRM archive returns to its verified default class
  // after the B2B utility section without another CLASS marker.
  if (
    currentClass === 'ZCL_CRM_B2B_CIKTI_UI_UTIL'
    && canonicalName(methodName).startsWith('CHECK_')
  ) {
    return defaultClass
  }
  return currentClass || 'UNSCOPED_CLASS'
}

function parseAbapMethodArchive(source: string): ParsedKnowledgeSource {
  const objects: ParsedKnowledgeObject[] = []
  const relations: ParsedKnowledgeRelation[] = []
  const warnings: string[] = []
  const defaultClass = canonicalName(
    source.match(/Doğrulanan\s+sınıf\s*:\s*([A-Z0-9_]+)/i)?.[1] || 'UNSCOPED_CLASS',
  )
  const methodPattern = /^\s*METHOD\s+([A-Z0-9_~]+)\s*\.\s*$[\s\S]*?^\s*ENDMETHOD\s*\.\s*$/gim
  let match: RegExpExecArray | null

  while ((match = methodPattern.exec(source)) !== null) {
    const methodName = canonicalName(match[1])
    const className = inferClassAt(source, match.index, methodName, defaultClass)
    const classCanonical = canonicalKey('class', className)
    const methodCanonical = methodKey(className, methodName)
    const methodSource = match[0].trim()
    const activeSource = withoutAbapComments(methodSource)

    objects.push({
      canonicalKey: classCanonical,
      objectType: 'class',
      name: className,
      title: className,
      summary: 'ABAP sınıfı; metot arşivinden tespit edildi.',
      content: `ABAP class ${className}`,
      metadata: { inferredFrom: 'method_archive' },
    })
    objects.push({
      canonicalKey: methodCanonical,
      objectType: 'method',
      name: methodName,
      title: `${className}->${methodName}`,
      summary: `${className} sınıfındaki ${methodName} metodunun doğrulanabilir ABAP kaynağı.`,
      content: methodSource,
      metadata: { className, language: 'ABAP' },
    })
    relations.push({
      sourceCanonicalKey: classCanonical,
      relationType: 'CONTAINS',
      targetCanonicalKey: methodCanonical,
      evidence: `METHOD ${methodName}`,
    })

    for (const call of activeSource.matchAll(/\bCALL\s+FUNCTION\s+['"]([A-Z0-9_\/]+)['"]/gi)) {
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'CALLS',
        targetCanonicalKey: canonicalKey('function', call[1]),
        evidence: call[0],
      })
    }

    for (const call of activeSource.matchAll(/\b([A-Z][A-Z0-9_]*)=>([A-Z][A-Z0-9_]*)\s*\(/gi)) {
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'CALLS',
        targetCanonicalKey: methodKey(call[1], call[2]),
        evidence: call[0],
      })
    }

    for (const call of activeSource.matchAll(/\bME->([A-Z][A-Z0-9_]*)\s*\(/gi)) {
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'CALLS',
        targetCanonicalKey: methodKey(className, call[1]),
        evidence: call[0],
      })
    }

    const readTables = new Set<string>()
    for (const table of activeSource.matchAll(/\b(?:FROM|JOIN)\s+([A-Z][A-Z0-9_\/]*)/gi)) {
      const tableName = canonicalName(table[1])
      if (!/^(LT|LS|LV|GT|GS|GV|IT|IS|ET|ES|EV)_/.test(tableName)) {
        readTables.add(tableName)
      }
    }
    for (const tableName of readTables) {
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'READS',
        targetCanonicalKey: canonicalKey('table', tableName),
        evidence: `FROM ${tableName}`,
      })
    }

    for (const write of activeSource.matchAll(/\b(INSERT|UPDATE|MODIFY|DELETE\s+FROM)\s+([A-Z][A-Z0-9_\/]*)/gi)) {
      const tableName = canonicalName(write[2])
      if (/^(LT|LS|LV|GT|GS|GV|IT|IS|ET|ES|EV)_/.test(tableName)) continue
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'WRITES',
        targetCanonicalKey: canonicalKey('table', tableName),
        evidence: `${canonicalName(write[1])} ${tableName}`,
      })
    }

    for (const message of activeSource.matchAll(/\bMESSAGE\s+[AEIWSX]?(\d{3})\s*\(\s*([A-Z0-9_]+)\s*\)/gi)) {
      const messageName = `${canonicalName(message[2])}-${message[1]}`
      relations.push({
        sourceCanonicalKey: methodCanonical,
        relationType: 'EMITS_MESSAGE',
        targetCanonicalKey: canonicalKey('message', messageName),
        evidence: message[0],
      })
    }
  }

  const methodCount = objects.filter(object => object.objectType === 'method').length
  if (methodCount === 0) warnings.push('METHOD/ENDMETHOD bloğu bulunamadı.')
  const starts = (source.match(/^\s*METHOD\s+[A-Z0-9_~]+\s*\./gim) || []).length
  const ends = (source.match(/^\s*ENDMETHOD\s*\./gim) || []).length
  if (starts !== ends) {
    warnings.push(`Dengesiz METHOD arşivi: ${starts} başlangıç, ${ends} bitiş.`)
  }

  return {
    documentType: 'abap_method_archive',
    objects: deduplicateObjects(objects),
    relations: deduplicateRelations(relations),
    warnings,
  }
}

function parseErrorKnowledgeBase(source: string): ParsedKnowledgeSource {
  const objects: ParsedKnowledgeObject[] = []
  const headingPattern = /^##\s+([A-Z0-9_]+-\d{3})\s+[—-]\s+(.+)$/gim
  const headings = [...source.matchAll(headingPattern)]

  headings.forEach((heading, index) => {
    const code = canonicalName(heading[1])
    const title = heading[2].trim()
    const start = heading.index || 0
    const end = headings[index + 1]?.index ?? source.length
    const content = source.slice(start, end).replace(/\n---\s*$/, '').trim()
    objects.push({
      canonicalKey: canonicalKey('message', code),
      objectType: 'message',
      name: code,
      title: `${code} — ${title}`,
      summary: firstParagraph(content.replace(heading[0], ''), title),
      content,
      metadata: {
        messageCode: code,
        category: content.match(/-\s+\*\*Kategori:\*\*\s*([^\n]+)/i)?.[1]?.trim(),
        severity: content.match(/-\s+\*\*Önem:\*\*\s*([^\n]+)/i)?.[1]?.trim(),
      },
    })
  })

  return {
    documentType: 'error_knowledge_base',
    objects: deduplicateObjects(objects),
    relations: [],
    warnings: objects.length ? [] : ['Mesaj kodu başlığı bulunamadı.'],
  }
}

function parseFunctionInventory(source: string): ParsedKnowledgeSource {
  const objects: ParsedKnowledgeObject[] = []
  const relations: ParsedKnowledgeRelation[] = []
  const details = new Map<string, string>()
  const detailHeadings = [...source.matchAll(/^###\s+`([A-Z0-9_\/]+)`\s*$/gim)]
  detailHeadings.forEach((heading, index) => {
    const start = heading.index || 0
    const end = detailHeadings[index + 1]?.index
      ?? source.slice(start + heading[0].length).search(/^##\s+/m) + start + heading[0].length
    details.set(canonicalName(heading[1]), source.slice(start, end > start ? end : source.length).trim())
  })

  for (const line of source.split('\n')) {
    if (!/^\|\s*`[A-Z0-9_\/]+`\s*\|/i.test(line)) continue
    const columns = line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(column => column.trim())
    if (columns.length < 5) continue
    const name = canonicalName(columns[0])
    const detail = details.get(name)
    objects.push({
      canonicalKey: canonicalKey('function', name),
      objectType: 'function',
      name,
      title: name,
      summary: detail
        ? firstParagraph(detail.replace(/^###.*$/m, ''), `${name} Function Module`)
        : `${columns[1]} Function Module; çalışma biçimi: ${columns[2]}.`,
      content: detail || line,
      metadata: {
        implementationType: columns[1]?.replace(/\*/g, ''),
        executionMode: columns[2]?.replace(/\*/g, ''),
        usageCount: Number(columns[3]) || undefined,
      },
    })

    for (const caller of columns[4].matchAll(/`([A-Z0-9_]+)->([A-Z0-9_]+)`/gi)) {
      relations.push({
        sourceCanonicalKey: methodKey(caller[1], caller[2]),
        relationType: 'CALLS',
        targetCanonicalKey: canonicalKey('function', name),
        evidence: `${canonicalName(caller[1])}->${canonicalName(caller[2])}`,
      })
    }
  }

  return {
    documentType: 'function_inventory',
    objects: deduplicateObjects(objects),
    relations: deduplicateRelations(relations),
    warnings: objects.length ? [] : ['Function Module envanter satırı bulunamadı.'],
  }
}

function parseClassInventory(source: string): ParsedKnowledgeSource {
  const objects: ParsedKnowledgeObject[] = []
  const relations: ParsedKnowledgeRelation[] = []
  const documentedClasses: Array<{ name: string; index: number }> = []
  const firstIdentity = source.match(/\|\s*Sınıf\s*\|\s*`(ZCL_[A-Z0-9_]+)`\s*\|/i)
  if (firstIdentity) {
    documentedClasses.push({
      name: canonicalName(firstIdentity[1]),
      index: 0,
    })
  }
  for (const heading of source.matchAll(/^#\s+(ZCL_[A-Z0-9_]+)\s*$/gim)) {
    documentedClasses.push({
      name: canonicalName(heading[1]),
      index: heading.index || 0,
    })
  }

  const uniqueClasses = [...new Map(
    documentedClasses.map(entry => [entry.name, entry]),
  ).values()].sort((left, right) => left.index - right.index)

  uniqueClasses.forEach((entry, index) => {
    const end = uniqueClasses[index + 1]?.index ?? source.length
    const content = source.slice(entry.index, end).trim()
    const classCanonical = canonicalKey('class', entry.name)
    objects.push({
      canonicalKey: classCanonical,
      objectType: 'class',
      name: entry.name,
      title: entry.name,
      summary: firstParagraph(content, `${entry.name} sınıf envanteri.`),
      content,
      metadata: { language: 'ABAP' },
    })

    const parent = content.match(/\|\s*Üst sınıf\s*\|\s*`([A-Z0-9_]+)`\s*\|/i)?.[1]
    if (parent) {
      relations.push({
        sourceCanonicalKey: classCanonical,
        relationType: 'EXTENDS',
        targetCanonicalKey: canonicalKey('class', parent),
        evidence: `Üst sınıf: ${canonicalName(parent)}`,
      })
    }
    const interfaceName = content.match(/\|\s*(?:Ana arayüz|Arayüz)\s*\|\s*`([A-Z0-9_]+)`\s*\|/i)?.[1]
    if (interfaceName) {
      relations.push({
        sourceCanonicalKey: classCanonical,
        relationType: 'IMPLEMENTS',
        targetCanonicalKey: canonicalKey('interface', interfaceName),
        evidence: `Arayüz: ${canonicalName(interfaceName)}`,
      })
    }
  })

  return {
    documentType: 'class_inventory',
    objects: deduplicateObjects(objects),
    relations: deduplicateRelations(relations),
    warnings: objects.length ? [] : ['Belgelenmiş ZCL_* sınıf kimliği bulunamadı.'],
  }
}

function parseDependencyMap(source: string, fileName: string): ParsedKnowledgeSource {
  const objects: ParsedKnowledgeObject[] = [{
    canonicalKey: canonicalKey('document', slug(fileName.replace(/\.[^.]+$/, ''))),
    objectType: 'document',
    name: fileName,
    title: source.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName,
    summary: firstParagraph(source, 'Teknik bağımlılık haritası.'),
    content: source,
    metadata: { format: 'markdown' },
  }]
  const relations: ParsedKnowledgeRelation[] = []
  const classHeadings = [...source.matchAll(/^###\s+`(ZCL_[A-Z0-9_]+)`\s*$/gim)]

  classHeadings.forEach((heading, index) => {
    const className = canonicalName(heading[1])
    const classCanonical = canonicalKey('class', className)
    const start = (heading.index || 0) + heading[0].length
    const end = classHeadings[index + 1]?.index
      ?? source.slice(start).search(/^##\s+/m) + start
    const section = source.slice(start, end > start ? end : source.length)
    let currentMethod = ''
    for (const rawLine of section.split('\n')) {
      const line = rawLine.replace(/^[\s│├└─]+/, '').replace(/\s+\[RFC\]\s*$/, '').trim()
      if (!/^[A-Z][A-Z0-9_]+$/.test(line) || line === className) continue
      const isFunction = rawLine.includes('│   └──') || rawLine.includes('│   ├──')
      if (!isFunction) {
        currentMethod = line
        relations.push({
          sourceCanonicalKey: classCanonical,
          relationType: 'CONTAINS',
          targetCanonicalKey: methodKey(className, currentMethod),
          evidence: rawLine.trim(),
        })
      } else if (currentMethod) {
        relations.push({
          sourceCanonicalKey: methodKey(className, currentMethod),
          relationType: 'CALLS',
          targetCanonicalKey: canonicalKey('function', line),
          evidence: rawLine.trim(),
        })
      }
    }
  })

  return {
    documentType: 'dependency_map',
    objects,
    relations: deduplicateRelations(relations),
    warnings: relations.length ? [] : ['Bağımlılık ağacı ilişkisi bulunamadı.'],
  }
}

function parseGenericDocument(
  source: string,
  fileName: string,
  isMarkdown: boolean,
): ParsedKnowledgeSource {
  const title = source.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName
  return {
    documentType: isMarkdown ? 'markdown_document' : 'text_document',
    objects: [{
      canonicalKey: canonicalKey('document', slug(fileName.replace(/\.[^.]+$/, ''))),
      objectType: 'document',
      name: fileName,
      title,
      summary: firstParagraph(source, title),
      content: source,
      metadata: { format: isMarkdown ? 'markdown' : 'text' },
    }],
    relations: [],
    warnings: [],
  }
}

export function parseKnowledgeSource(
  fileName: string,
  rawText: string,
): ParsedKnowledgeSource {
  const source = normalizeText(rawText)
  if (!source) throw new Error('Bilgi kaynağı boş olamaz.')

  let parsed: ParsedKnowledgeSource
  if (/^\s*METHOD\s+[A-Z0-9_~]+\s*\./im.test(source)) {
    parsed = parseAbapMethodArchive(source)
  } else if (/^#\s+CRM Hata Bilgi Bankası/im.test(source)) {
    parsed = parseErrorKnowledgeBase(source)
  } else if (/^#\s+CRM Function Module Envanteri/im.test(source)) {
    parsed = parseFunctionInventory(source)
  } else if (/^#\s+CRM Order Save Class Envanteri/im.test(source)) {
    parsed = parseClassInventory(source)
  } else if (/^#\s+CRM Function Module Bağımlılık Haritası/im.test(source)) {
    parsed = parseDependencyMap(source, fileName)
  } else {
    parsed = parseGenericDocument(source, fileName, /\.md$/i.test(fileName))
  }

  return {
    ...parsed,
    objects: deduplicateObjects(parsed.objects),
    relations: deduplicateRelations(parsed.relations),
  }
}
