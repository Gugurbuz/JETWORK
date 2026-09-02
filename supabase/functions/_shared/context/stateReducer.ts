export const RESOLVED_STATE_VERSION = 'resolved-conversation-state-v2'

export type ConversationStateClass =
  | 'EPHEMERAL'
  | 'DECISION'
  | 'CORRECTION'
  | 'PROGRESS'
  | 'PROJECT_FACT'
  | 'AI_HYPOTHESIS'

export type ConversationStateSource =
  | 'user'
  | 'verified_evidence'
  | 'artifact'
  | 'runtime'
  | 'assistant'

export interface ResolvedStateEntry {
  key: string
  value: string
  source: ConversationStateSource
  evidenceRefs: string[]
  updatedAt?: string
}

export interface ResolvedConversationStateV2 {
  version: typeof RESOLVED_STATE_VERSION
  goal?: string
  currentTask?: string
  decisions: ResolvedStateEntry[]
  projectFacts: ResolvedStateEntry[]
  completed: ResolvedStateEntry[]
  openItems: ResolvedStateEntry[]
  corrections: ResolvedStateEntry[]
  nextAction?: string
}

export interface StateUpdateCandidate {
  class: ConversationStateClass
  key: string
  value: string
  source: ConversationStateSource
  evidenceRefs?: readonly string[]
  progressState?: 'open' | 'completed'
  correctionTarget?: 'decision' | 'project_fact' | 'progress' | 'goal' | 'current_task' | 'next_action'
  updatedAt?: string
}

export interface StateReductionResult {
  state: ResolvedConversationStateV2
  applied: StateUpdateCandidate[]
  dropped: Array<{ candidate: StateUpdateCandidate; reason: string }>
}

const clean = (value: unknown, max = 2_000) => String(value ?? '').trim().slice(0, max)
const unique = (values: readonly string[] | undefined, limit = 12) => [...new Set((values || [])
  .map(value => clean(value, 240))
  .filter(Boolean))].slice(0, limit)

export const emptyResolvedConversationState = (): ResolvedConversationStateV2 => ({
  version: RESOLVED_STATE_VERSION,
  decisions: [],
  projectFacts: [],
  completed: [],
  openItems: [],
  corrections: [],
})

const normalizeCandidate = (candidate: StateUpdateCandidate): StateUpdateCandidate => ({
  ...candidate,
  key: clean(candidate.key, 240),
  value: clean(candidate.value, 2_000),
  evidenceRefs: unique(candidate.evidenceRefs),
  updatedAt: clean(candidate.updatedAt, 80) || undefined,
})

const entryFor = (candidate: StateUpdateCandidate): ResolvedStateEntry => ({
  key: candidate.key,
  value: candidate.value,
  source: candidate.source,
  evidenceRefs: unique(candidate.evidenceRefs),
  updatedAt: candidate.updatedAt,
})

const upsertEntry = (entries: ResolvedStateEntry[], entry: ResolvedStateEntry) => [
  ...entries.filter(existing => existing.key !== entry.key),
  entry,
]

const removeEntry = (entries: ResolvedStateEntry[], key: string) => entries.filter(entry => entry.key !== key)

const applyCorrection = (
  state: ResolvedConversationStateV2,
  candidate: StateUpdateCandidate,
): { state: ResolvedConversationStateV2; error?: string } => {
  if (candidate.source !== 'user') return { state, error: 'correction_requires_user_source' }
  if (!candidate.correctionTarget) return { state, error: 'correction_target_required' }

  const correction = entryFor(candidate)
  const next: ResolvedConversationStateV2 = {
    ...state,
    corrections: upsertEntry(state.corrections, correction),
  }

  if (candidate.correctionTarget === 'decision') {
    next.decisions = candidate.value
      ? upsertEntry(state.decisions, correction)
      : removeEntry(state.decisions, candidate.key)
  } else if (candidate.correctionTarget === 'project_fact') {
    next.projectFacts = candidate.value
      ? upsertEntry(state.projectFacts, correction)
      : removeEntry(state.projectFacts, candidate.key)
  } else if (candidate.correctionTarget === 'progress') {
    next.completed = removeEntry(state.completed, candidate.key)
    next.openItems = candidate.value
      ? upsertEntry(state.openItems, correction)
      : removeEntry(state.openItems, candidate.key)
  } else if (candidate.correctionTarget === 'goal') {
    next.goal = candidate.value || undefined
  } else if (candidate.correctionTarget === 'current_task') {
    next.currentTask = candidate.value || undefined
  } else if (candidate.correctionTarget === 'next_action') {
    next.nextAction = candidate.value || undefined
  }

  return { state: next }
}

/**
 * Applies already-structured state events. It never infers intent from raw user
 * text. Semantic classification belongs to the controller; this reducer only
 * enforces persistence/trust invariants mechanically.
 */
export const reduceResolvedConversationState = (
  initial: ResolvedConversationStateV2,
  rawCandidates: readonly StateUpdateCandidate[],
): StateReductionResult => {
  let state: ResolvedConversationStateV2 = {
    ...emptyResolvedConversationState(),
    ...initial,
    version: RESOLVED_STATE_VERSION,
    decisions: [...(initial.decisions || [])],
    projectFacts: [...(initial.projectFacts || [])],
    completed: [...(initial.completed || [])],
    openItems: [...(initial.openItems || [])],
    corrections: [...(initial.corrections || [])],
  }
  const applied: StateUpdateCandidate[] = []
  const dropped: Array<{ candidate: StateUpdateCandidate; reason: string }> = []

  for (const rawCandidate of rawCandidates) {
    const candidate = normalizeCandidate(rawCandidate)
    if (!candidate.key || !candidate.value) {
      dropped.push({ candidate, reason: 'empty_key_or_value' })
      continue
    }

    if (candidate.class === 'EPHEMERAL') {
      dropped.push({ candidate, reason: 'ephemeral_not_persisted' })
      continue
    }
    if (candidate.class === 'AI_HYPOTHESIS') {
      dropped.push({ candidate, reason: 'ai_hypothesis_not_durable' })
      continue
    }

    if (candidate.class === 'DECISION') {
      if (candidate.source !== 'user') {
        dropped.push({ candidate, reason: 'decision_requires_user_source' })
        continue
      }
      state.decisions = upsertEntry(state.decisions, entryFor(candidate))
      applied.push(candidate)
      continue
    }

    if (candidate.class === 'CORRECTION') {
      const corrected = applyCorrection(state, candidate)
      if (corrected.error) {
        dropped.push({ candidate, reason: corrected.error })
        continue
      }
      state = corrected.state
      applied.push(candidate)
      continue
    }

    if (candidate.class === 'PROJECT_FACT') {
      const trustedUserFact = candidate.source === 'user'
      const trustedEvidenceFact = candidate.source === 'verified_evidence' && unique(candidate.evidenceRefs).length > 0
      if (!trustedUserFact && !trustedEvidenceFact) {
        dropped.push({ candidate, reason: 'project_fact_requires_user_or_verified_evidence' })
        continue
      }
      state.projectFacts = upsertEntry(state.projectFacts, entryFor(candidate))
      applied.push(candidate)
      continue
    }

    if (candidate.class === 'PROGRESS') {
      if (!['user','runtime','artifact'].includes(candidate.source)) {
        dropped.push({ candidate, reason: 'progress_requires_authoritative_source' })
        continue
      }
      const entry = entryFor(candidate)
      if (candidate.progressState === 'completed') {
        state.completed = upsertEntry(state.completed, entry)
        state.openItems = removeEntry(state.openItems, candidate.key)
      } else {
        state.openItems = upsertEntry(state.openItems, entry)
        state.completed = removeEntry(state.completed, candidate.key)
      }
      applied.push(candidate)
    }
  }

  return { state, applied, dropped }
}

/**
 * Only these classes can become durable Project Memory candidates. The caller
 * still owns DB persistence/versioning; this function merely enforces the trust
 * boundary before a write is even considered.
 */
export const durableProjectMemoryCandidates = (candidates: readonly StateUpdateCandidate[]) => candidates
  .map(normalizeCandidate)
  .filter(candidate => {
    if (!candidate.key || !candidate.value) return false
    if (candidate.class === 'DECISION') return candidate.source === 'user'
    if (candidate.class === 'CORRECTION') return candidate.source === 'user'
    if (candidate.class === 'PROJECT_FACT') {
      return candidate.source === 'user'
        || (candidate.source === 'verified_evidence' && unique(candidate.evidenceRefs).length > 0)
    }
    return false
  })
