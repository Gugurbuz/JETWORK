export interface PresentationMetadataExtraction {
  visibleText: string
  metadata: Array<Record<string, unknown>>
  strippedBlocks: number
}

const META_OPEN = '<jetwork_meta>'
const META_CLOSE = '</jetwork_meta>'
const COMPLETE_META_BLOCK = /<jetwork_meta>\s*([\s\S]*?)\s*<\/jetwork_meta>/giu

const normalize = (value: string) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const parseMetadata = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(String(value || '').trim())
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const extractJetWorkPresentationMetadata = (rawText: string): PresentationMetadataExtraction => {
  const metadata: Array<Record<string, unknown>> = []
  let strippedBlocks = 0
  let visibleText = String(rawText || '').replace(COMPLETE_META_BLOCK, (_match, jsonText: string) => {
    const parsed = parseMetadata(jsonText)
    if (parsed) metadata.push(parsed)
    strippedBlocks += 1
    return '\n'
  })

  const incompleteIndex = visibleText.toLocaleLowerCase('tr-TR').indexOf(META_OPEN)
  if (incompleteIndex >= 0) {
    visibleText = visibleText.slice(0, incompleteIndex)
    strippedBlocks += 1
  }

  return {
    visibleText: visibleText.trim(),
    metadata,
    strippedBlocks,
  }
}

export const stripJetWorkPresentationMetadata = (rawText: string): string => (
  extractJetWorkPresentationMetadata(rawText).visibleText
)

const shouldPreserveLegacyArtifactMetadata = (
  visibleText: string,
  metadata: Record<string, unknown> | null,
): boolean => {
  if (!metadata) return false
  const questions = Array.isArray(metadata.questions) ? metadata.questions : []
  const actionSummary = typeof metadata.actionSummary === 'string' ? metadata.actionSummary : ''
  const combined = normalize(`${visibleText} ${actionSummary}`)
  const artifactSignal = /\b(?:dokuman\w*|belge\w*|ihtiyac analizi\w*|is analizi\w*|ba analiz\w*|canvas\w*|kanvas\w*|artifact\w*)\b/u.test(combined)
  const structuredArtifact = combined.includes('1. analiz kapsami')
    || combined.includes('4. fonksiyonel gereksinimler')
    || combined.includes('8. fonksiyonel tasarim dokumanlari')
  return (artifactSignal && questions.length > 0) || structuredArtifact
}

export interface PresentationDeltaResult {
  delta: string
  metadataStripped: number
}

/**
 * Streaming-safe presentation boundary. It withholds only characters that may
 * form the private <jetwork_meta> tag, so normal answer streaming is not
 * buffered. Legacy artifact metadata is temporarily preserved for the existing
 * document client; ordinary chat/listing metadata is never emitted as text.
 */
export const createJetWorkPresentationDeltaBoundary = () => {
  let mode: 'visible' | 'metadata' = 'visible'
  let candidate = ''
  let metadataBody = ''
  let visibleHistory = ''
  let stripped = 0

  const push = (input: string): PresentationDeltaResult => {
    let visible = ''
    const text = String(input || '')

    for (const char of text) {
      if (mode === 'visible') {
        if (!candidate) {
          if (char === '<') candidate = char
          else {
            visible += char
            visibleHistory += char
          }
          continue
        }

        candidate += char
        const lower = candidate.toLocaleLowerCase('tr-TR')
        if (META_OPEN.startsWith(lower)) {
          if (lower === META_OPEN) {
            candidate = ''
            metadataBody = ''
            mode = 'metadata'
          }
          continue
        }

        visible += candidate
        visibleHistory += candidate
        candidate = ''
        continue
      }

      // metadata mode
      if (!candidate) {
        if (char === '<') candidate = char
        else metadataBody += char
        continue
      }

      candidate += char
      const lower = candidate.toLocaleLowerCase('tr-TR')
      if (META_CLOSE.startsWith(lower)) {
        if (lower === META_CLOSE) {
          const parsed = parseMetadata(metadataBody)
          if (shouldPreserveLegacyArtifactMetadata(visibleHistory, parsed)) {
            const legacy = `${META_OPEN}${metadataBody}${META_CLOSE}`
            visible += legacy
            visibleHistory += legacy
          } else {
            stripped += 1
          }
          candidate = ''
          metadataBody = ''
          mode = 'visible'
        }
        continue
      }

      metadataBody += candidate
      candidate = ''
    }

    return { delta: visible, metadataStripped: stripped }
  }

  const finish = (): PresentationDeltaResult => {
    let visible = ''
    if (mode === 'visible' && candidate) {
      visible = candidate
      visibleHistory += candidate
      candidate = ''
    } else if (mode === 'metadata') {
      // An incomplete private block must never become user-visible text.
      stripped += 1
      candidate = ''
      metadataBody = ''
      mode = 'visible'
    }
    return { delta: visible, metadataStripped: stripped }
  }

  return {
    push,
    finish,
    strippedCount: () => stripped,
  }
}
