import type { EvidenceMapV2 } from './evidenceMap.ts'

export const EVIDENCE_CRITIC_VERSION = 'evidence-critic-v2'

export interface EvidenceCriticObservation {
  version: typeof EVIDENCE_CRITIC_VERSION
  coverage: number
  gaps: string[]
  conflicts: string[]
  suggestedFocus: string[]
  controllerDecisionRequired: true
}

const unique = (values: string[], limit = 24) => [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, limit)

/**
 * Produces a structured observation for the controller. It never selects a tool,
 * routes a domain, forces another search, or decides whether the turn is final.
 */
export const critiqueEvidenceMap = (map: EvidenceMapV2): EvidenceCriticObservation => {
  const aspects = map.aspects
  const score = aspects.length
    ? aspects.reduce((sum, aspect) => sum + (aspect.status === 'covered' ? 1 : aspect.status === 'partial' ? 0.5 : 0), 0) / aspects.length
    : 0
  const gaps = aspects
    .filter(aspect => aspect.status !== 'covered')
    .map(aspect => `${aspect.label}: ${aspect.status === 'partial' ? 'partially supported' : 'no verified evidence'}`)
  const conflicts = unique(map.evidence.flatMap(item => item.conflicts))
  const suggestedFocus = unique([
    ...aspects.filter(aspect => aspect.status === 'open').map(aspect => `verify ${aspect.label}`),
    ...aspects.filter(aspect => aspect.status === 'partial').map(aspect => `strengthen evidence for ${aspect.label}`),
    ...conflicts.map(conflict => `resolve conflict: ${conflict}`),
  ])

  return {
    version: EVIDENCE_CRITIC_VERSION,
    coverage: Math.round(score * 1000) / 1000,
    gaps: unique(gaps),
    conflicts,
    suggestedFocus,
    controllerDecisionRequired: true,
  }
}
