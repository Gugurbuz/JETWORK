const normalize = (value: string): string => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9%./\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const TECHNICAL_ANCHORS = [
  { label: 'SAP', pattern: /\bsap\b/i },
  { label: 'CRM', pattern: /\bcrm\b/i },
  { label: 'C4C', pattern: /\bc4c\b/i },
  { label: 'FICA', pattern: /\b(?:fica|fi-ca)\b/i },
  { label: 'IS-U', pattern: /\b(?:is-u|isu)\b/i },
  { label: 'Billing', pattern: /\bbilling\b/i },
  { label: 'CPI', pattern: /\bcpi\b/i },
  { label: 'IYS', pattern: /\biys\b/i },
  { label: 'Findeks', pattern: /\bfindeks\b/i },
  { label: 'KKB', pattern: /\bkkb\b/i },
  { label: 'D2D', pattern: /\bd2d\b/i },
  { label: 'Ninja', pattern: /\bninja\b/i },
  { label: 'BPM', pattern: /\bbpm\b/i },
] as const

const PROCESS_STEP_PATTERN = /^\s*(?:süreç|surec)\s*(?:adım|adim)?\s*\d+\s*[-:.)]\s*(.+?)\s*$/i

export interface ArtifactSourceFidelityResult {
  markdown: string
  processSteps: string[]
  injectedProcessSteps: string[]
  removedUnsupportedTechnicalLines: number
  replacedUnsupportedCommitments: number
}

export function extractExplicitProcessSteps(sourceRequestText: string): string[] {
  const seen = new Set<string>()
  const steps: string[] = []
  for (const rawLine of sourceRequestText.split(/\r?\n/)) {
    const match = rawLine.match(PROCESS_STEP_PATTERN)
    const step = match?.[1]?.trim()
    if (!step) continue
    const key = normalize(step)
    if (!key || seen.has(key)) continue
    seen.add(key)
    steps.push(step.slice(0, 500))
  }
  return steps.slice(0, 20)
}

function sourceSupportsTechnicalAnchor(sourceNormalized: string, pattern: RegExp): boolean {
  return pattern.test(sourceNormalized)
}

function containsUnsupportedTechnicalAnchor(line: string, sourceNormalized: string): boolean {
  return TECHNICAL_ANCHORS.some(anchor => (
    anchor.pattern.test(line)
    && !sourceSupportsTechnicalAnchor(sourceNormalized, anchor.pattern)
  ))
}

function replaceUnsupportedTableRow(line: string): string {
  const cells = line.split('|')
  if (cells.length < 4) return '[AÇIK KONU]'
  const firstValueIndex = cells.findIndex((cell, index) => index > 0 && cell.trim())
  if (firstValueIndex < 0) return '[AÇIK KONU]'
  const label = cells[firstValueIndex].trim()
  return `| ${label} | [AÇIK KONU] |`
}

function sanitizeUnsupportedTechnicalLines(markdown: string, sourceRequestText: string): {
  markdown: string
  removed: number
} {
  const processSteps = extractExplicitProcessSteps(sourceRequestText)
  // Strict source-only protection is intentionally limited to user-defined functional
  // process contracts. Technical requests may legitimately be enriched from Knowledge v2.
  if (processSteps.length < 2) return { markdown, removed: 0 }

  const sourceNormalized = normalize(sourceRequestText)
  let removed = 0
  const lines = markdown.split('\n').map(line => {
    if (!containsUnsupportedTechnicalAnchor(line, sourceNormalized)) return line
    removed += 1
    if (/^\s*\|/.test(line)) return replaceUnsupportedTableRow(line)
    if (/^\s*[-*]\s+/.test(line)) return '- [AÇIK KONU]'
    return '[AÇIK KONU]'
  })
  return { markdown: lines.join('\n'), removed }
}

const COMMITMENT_PATTERN = /(?:\b\d+(?:[.,]\d+)?\s*(?:ms|milisaniye|saniye|sn|dakika|dk|saat|gun|gün|hafta|ay|yil|yıl|kayit|kayıt|tl|%)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b)/i

function sanitizeUnsupportedCommitments(markdown: string, sourceRequestText: string): {
  markdown: string
  replaced: number
} {
  const processSteps = extractExplicitProcessSteps(sourceRequestText)
  if (processSteps.length < 2) return { markdown, replaced: 0 }

  const sourceNormalized = normalize(sourceRequestText)
  let replaced = 0
  const lines = markdown.split('\n').map(line => {
    const match = line.match(COMMITMENT_PATTERN)
    if (!match) return line
    const commitment = normalize(match[0])
    if (commitment && sourceNormalized.includes(commitment)) return line
    replaced += 1
    if (/^\s*\|/.test(line)) return replaceUnsupportedTableRow(line)
    return line.replace(match[0], '[AÇIK KONU]')
  })
  return { markdown: lines.join('\n'), replaced }
}

function injectMissingProcessSteps(markdown: string, sourceRequestText: string): {
  markdown: string
  processSteps: string[]
  injected: string[]
} {
  const processSteps = extractExplicitProcessSteps(sourceRequestText)
  if (!processSteps.length) return { markdown, processSteps, injected: [] }

  const normalizedDocument = normalize(markdown)
  const injected = processSteps.filter(step => !normalizedDocument.includes(normalize(step)))
  if (!injected.length) return { markdown, processSteps, injected: [] }

  const headingPattern = /^(###\s*4\.2\.\s*Süreç Akışı\s*)$/im
  const headingMatch = markdown.match(headingPattern)
  const sourceBlock = [
    '',
    '**Kullanıcı tarafından tanımlanan süreç adımları (kaynak ifade korunmuştur):**',
    ...processSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
  ].join('\n')

  if (headingMatch?.index !== undefined) {
    const insertAt = headingMatch.index + headingMatch[0].length
    return {
      markdown: `${markdown.slice(0, insertAt)}${sourceBlock}${markdown.slice(insertAt)}`,
      processSteps,
      injected,
    }
  }

  return {
    markdown: `${markdown.trimEnd()}\n\n### 4.2. Süreç Akışı${sourceBlock}`,
    processSteps,
    injected,
  }
}

export function enforceArtifactSourceFidelity(
  businessAnalysisMarkdown: string,
  sourceRequestText: string,
): ArtifactSourceFidelityResult {
  const technical = sanitizeUnsupportedTechnicalLines(businessAnalysisMarkdown, sourceRequestText)
  const commitments = sanitizeUnsupportedCommitments(technical.markdown, sourceRequestText)
  const process = injectMissingProcessSteps(commitments.markdown, sourceRequestText)
  return {
    markdown: process.markdown,
    processSteps: process.processSteps,
    injectedProcessSteps: process.injected,
    removedUnsupportedTechnicalLines: technical.removed,
    replacedUnsupportedCommitments: commitments.replaced,
  }
}
