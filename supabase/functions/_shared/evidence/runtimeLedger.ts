import type { AssistantToolExecution } from '../assistantTools.ts'
import type { ReasoningSourceRef } from '../reasoningEngine.ts'
import {
  addEvidence,
  createEvidenceMap,
  registerConflict,
  setCoverageAspects,
  type CoverageAspect,
  type EvidenceMapV2,
  type EvidenceRefV2,
} from './evidenceMap.ts'
import { critiqueEvidenceMap, type EvidenceCriticObservation } from './critic.ts'

export const EVIDENCE_RUNTIME_LEDGER_VERSION = 'evidence-runtime-ledger-v2'

const clean = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max)
const stableEvidenceId = (input: { sourceType: string; sourceId?: string; canonicalKey?: string; url?: string; sourceName: string }) => {
  const raw = [input.sourceType, input.sourceId || '', input.canonicalKey || '', input.url || '', input.sourceName].join('|')
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ev_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export interface EvidenceRuntimeLedger {
  version: typeof EVIDENCE_RUNTIME_LEDGER_VERSION
  map: EvidenceMapV2
}

export const createEvidenceRuntimeLedger = (question: string): EvidenceRuntimeLedger => ({
  version: EVIDENCE_RUNTIME_LEDGER_VERSION,
  map: createEvidenceMap(question),
})

const evidenceFromSource = (source: ReasoningSourceRef): EvidenceRefV2 | null => {
  const sourceType = source.sourceType === 'web' ? 'web' : 'knowledge'
  const url = clean(source.url, 2_000)
  const sourceName = clean(source.sourceName, 500)
  if (!sourceName) return null
  if (sourceType === 'web' && !/^https?:\/\//i.test(url)) return null
  return {
    id: stableEvidenceId({
      sourceType,
      sourceId: clean(source.sourceId, 500),
      canonicalKey: clean(source.canonicalKey, 500),
      url,
      sourceName,
    }),
    source: sourceType === 'web' ? url : sourceName,
    sourceType,
    object: clean(source.canonicalKey || source.title, 320) || undefined,
    supports: [],
    trustLevel: sourceType === 'web' ? 'verified-public-source' : 'published-enterprise-source',
    freshness: undefined,
    scope: undefined,
    conflicts: [],
    metadata: {
      sourceId: clean(source.sourceId, 500) || null,
      canonicalKey: clean(source.canonicalKey, 500) || null,
      title: clean(source.title, 500) || null,
      sourceName,
    },
  }
}

/**
 * Adds only mechanically verified sources returned by a completed tool result.
 * It never decides what claim/aspect those sources support.
 */
export const recordVerifiedToolEvidence = (
  ledger: EvidenceRuntimeLedger,
  result: AssistantToolExecution,
): EvidenceRuntimeLedger => {
  if (result.summary?.citationReady !== true) return ledger
  let map = ledger.map
  for (const source of result.sources || []) {
    const evidence = evidenceFromSource({ ...source, sourceType: 'knowledge' })
    if (evidence) map = addEvidence(map, evidence)
  }
  return { ...ledger, map }
}

export const recordVerifiedWebEvidence = (
  ledger: EvidenceRuntimeLedger,
  sources: readonly ReasoningSourceRef[],
): EvidenceRuntimeLedger => {
  let map = ledger.map
  for (const source of sources) {
    if (source.sourceType !== 'web') continue
    const evidence = evidenceFromSource(source)
    if (evidence) map = addEvidence(map, evidence)
  }
  return { ...ledger, map }
}

export interface ControllerCoverageProposal {
  aspects: Array<{
    id: string
    label: string
    evidenceIds: string[]
    status: CoverageAspect['status']
  }>
}

export interface ControllerConflictProposal {
  conflicts: Array<{
    key: string
    evidenceIds: string[]
  }>
}

/**
 * The controller proposes semantic coverage. Runtime only validates that cited
 * evidence IDs actually exist; setCoverageAspects mechanically downgrades a
 * claimed covered aspect with no verified evidence to open.
 */
export const applyControllerCoverageProposal = (
  ledger: EvidenceRuntimeLedger,
  proposal: ControllerCoverageProposal,
): EvidenceRuntimeLedger => ({
  ...ledger,
  map: setCoverageAspects(ledger.map, proposal.aspects),
})

/**
 * Conflict meaning is proposed by the controller. Runtime only attaches the
 * conflict key to evidence IDs that already exist in the verified ledger.
 */
export const applyControllerConflictProposal = (
  ledger: EvidenceRuntimeLedger,
  proposal: ControllerConflictProposal,
): EvidenceRuntimeLedger => {
  const known = new Set(ledger.map.evidence.map(item => item.id))
  let map = ledger.map
  for (const conflict of proposal.conflicts) {
    const key = clean(conflict.key, 240)
    const evidenceIds = [...new Set((conflict.evidenceIds || []).map(id => clean(id, 160)).filter(id => known.has(id)))].slice(0, 24)
    if (!key || evidenceIds.length < 2) continue
    map = registerConflict(map, key, evidenceIds)
  }
  return { ...ledger, map }
}

export const evidenceCriticObservation = (ledger: EvidenceRuntimeLedger): EvidenceCriticObservation => (
  critiqueEvidenceMap(ledger.map)
)

export const evidenceLedgerObservation = (ledger: EvidenceRuntimeLedger) => ({
  version: ledger.version,
  evidenceMapVersion: ledger.map.version,
  evidence: ledger.map.evidence.map(item => ({
    id: item.id,
    source: item.source,
    sourceType: item.sourceType,
    object: item.object || null,
    trustLevel: item.trustLevel,
    conflicts: item.conflicts,
  })),
  aspects: ledger.map.aspects,
  critic: evidenceCriticObservation(ledger),
  instruction: 'This is an observation only. Evidence IDs are mechanically verified; coverage/conflict labels are controller proposals constrained to real evidence IDs. Decide whether to research, use another capability, or answer based on the user goal and remaining uncertainty.',
})
