import type { AssistantPromptProfile, ReasoningPlan } from './reasoningEngine.ts'

const DOCUMENT_MARKER = '[ENERJİSA İHTİYAÇ ANALİZİ DOKÜMAN SÖZLEŞMESİ - ZORUNLU]'
const PRESENTATION_MARKER = '[JETWORK SUNUM METADATA SÖZLEŞMESİ - ZORUNLU]'
const QUALITY_MARKER = '[JETWORK PRODUCT QUALITY CONTRACT v1]'
const EXACT_EVIDENCE_MARKER = '[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]'
const RUNTIME_MARKER = '[JETWORK REASONING ENGINE V2 - OPERATIONAL CONTEXT]'

const clean = (value: string) => value.replace(/\n{3,}/g, '\n\n').trim()

const markerIndex = (value: string, marker: string) => {
  const index = value.indexOf(marker)
  return index >= 0 ? index : Number.POSITIVE_INFINITY
}

export const promptProfileForPlan = (plan: ReasoningPlan | null): AssistantPromptProfile => {
  const explicit = String(plan?.promptProfile || '') as AssistantPromptProfile
  if (['base','knowledge','research','document','artifact'].includes(explicit)) return explicit
  if (plan?.executionMode === 'artifact') return 'artifact'
  if (plan?.intent === 'document') return 'document'
  if (plan?.webMode !== 'none' || plan?.intent === 'research') return 'research'
  if (plan?.knowledgeRequired || ['analysis','sap_diagnosis'].includes(String(plan?.intent || ''))) return 'knowledge'
  return 'base'
}

const splitRuntime = (value: string) => {
  const runtimeIndex = value.indexOf(RUNTIME_MARKER)
  if (runtimeIndex < 0) return { configured: value.trim(), runtime: '' }
  return {
    configured: value.slice(0, runtimeIndex).trim(),
    runtime: value.slice(runtimeIndex).trim(),
  }
}

const extractConfiguredSections = (configured: string) => {
  const documentIndex = markerIndex(configured, DOCUMENT_MARKER)
  const presentationIndex = markerIndex(configured, PRESENTATION_MARKER)
  const qualityIndex = markerIndex(configured, QUALITY_MARKER)
  const exactIndex = markerIndex(configured, EXACT_EVIDENCE_MARKER)
  const firstContract = Math.min(documentIndex, presentationIndex, qualityIndex, exactIndex)
  if (!Number.isFinite(firstContract)) {
    return { base: configured.trim(), document: '', presentation: '', quality: '', exact: '' }
  }

  const boundaries = [
    { name: 'document', index: documentIndex },
    { name: 'presentation', index: presentationIndex },
    { name: 'quality', index: qualityIndex },
    { name: 'exact', index: exactIndex },
  ].filter(item => Number.isFinite(item.index)).sort((a, b) => a.index - b.index)

  const sections: Record<string, string> = {
    base: configured.slice(0, firstContract).trim(),
    document: '', presentation: '', quality: '', exact: '',
  }
  boundaries.forEach((item, index) => {
    const end = boundaries[index + 1]?.index ?? configured.length
    sections[item.name] = configured.slice(item.index, end).trim()
  })
  return sections as { base: string; document: string; presentation: string; quality: string; exact: string }
}

export const composeAssistantPrompt = (
  rawInstructions: string,
  plan: ReasoningPlan | null,
): string => {
  const source = String(rawInstructions || '').trim()
  if (!source) return source
  const profile = promptProfileForPlan(plan)
  const { configured, runtime } = splitRuntime(source)
  const sections = extractConfiguredSections(configured)

  // If the active prompt does not expose the known contract markers, preserve it.
  if (!sections.document && !sections.presentation && !sections.quality && !sections.exact) return source

  const configuredParts = profile === 'artifact' || profile === 'document'
    ? [sections.base, sections.document, sections.presentation, sections.quality, sections.exact]
    : profile === 'knowledge' || profile === 'research'
      ? [sections.base, sections.exact]
      : [sections.base]

  return clean([
    ...configuredParts,
    `[JETWORK PROMPT PROFILE: ${profile}]`,
    runtime,
  ].filter(Boolean).join('\n\n'))
}
