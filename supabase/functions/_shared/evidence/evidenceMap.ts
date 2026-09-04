export const EVIDENCE_MAP_VERSION = 'evidence-map-v2'

export type EvidenceSourceType = 'knowledge' | 'web' | 'user' | 'artifact' | 'runtime'
export type EvidenceTrustLevel = 'published-enterprise-source' | 'verified-public-source' | 'user-provided' | 'artifact-output' | 'runtime-observation' | 'unverified'

export interface EvidenceRefV2 {
  id: string
  source: string
  sourceType: EvidenceSourceType
  object?: string
  supports: string[]
  trustLevel: EvidenceTrustLevel
  freshness?: string
  scope?: string
  conflicts: string[]
  metadata?: Record<string, unknown>
}

export interface CoverageAspect {
  id: string
  label: string
  evidenceIds: string[]
  status: 'covered' | 'partial' | 'open'
}

export interface EvidenceMapV2 {
  version: typeof EVIDENCE_MAP_VERSION
  question: string
  evidence: EvidenceRefV2[]
  aspects: CoverageAspect[]
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)
const unique = (values: readonly string[] | undefined, limit = 32) => [...new Set((values || [])
  .map(value => clean(value, 500))
  .filter(Boolean))].slice(0, limit)

export const createEvidenceMap = (question: string): EvidenceMapV2 => ({
  version: EVIDENCE_MAP_VERSION,
  question: clean(question, 4_000),
  evidence: [],
  aspects: [],
})

export const addEvidence = (map: EvidenceMapV2, raw: EvidenceRefV2): EvidenceMapV2 => {
  const evidence: EvidenceRefV2 = {
    ...raw,
    id: clean(raw.id, 160),
    source: clean(raw.source, 500),
    object: clean(raw.object, 320) || undefined,
    supports: unique(raw.supports),
    conflicts: unique(raw.conflicts),
    freshness: clean(raw.freshness, 120) || undefined,
    scope: clean(raw.scope, 160) || undefined,
    metadata: raw.metadata ? { ...raw.metadata } : undefined,
  }
  if (!evidence.id || !evidence.source) return map
  return {
    ...map,
    evidence: [...map.evidence.filter(item => item.id !== evidence.id), evidence],
  }
}

export const setCoverageAspects = (map: EvidenceMapV2, rawAspects: readonly CoverageAspect[]): EvidenceMapV2 => {
  const knownEvidenceIds = new Set(map.evidence.map(item => item.id))
  const aspects = rawAspects.map(aspect => {
    const evidenceIds = unique(aspect.evidenceIds, 24).filter(id => knownEvidenceIds.has(id))
    const requestedStatus = ['covered','partial','open'].includes(aspect.status) ? aspect.status : 'open'
    const status: CoverageAspect['status'] = evidenceIds.length === 0 && requestedStatus === 'covered'
      ? 'open'
      : requestedStatus
    return {
      id: clean(aspect.id, 160),
      label: clean(aspect.label, 500),
      evidenceIds,
      status,
    }
  }).filter(aspect => aspect.id && aspect.label)
  return { ...map, aspects }
}

export const registerConflict = (
  map: EvidenceMapV2,
  conflictKey: string,
  evidenceIds: readonly string[],
): EvidenceMapV2 => {
  const key = clean(conflictKey, 240)
  if (!key) return map
  const targets = new Set(evidenceIds.map(id => clean(id, 160)).filter(Boolean))
  return {
    ...map,
    evidence: map.evidence.map(item => targets.has(item.id)
      ? { ...item, conflicts: unique([...item.conflicts, key]) }
      : item),
  }
}

export const evidenceById = (map: EvidenceMapV2) => new Map(map.evidence.map(item => [item.id, item]))
