import type { AssistantToolExecution } from '../assistantTools.ts'
import type { ReasoningSourceRef } from '../reasoningEngine.ts'
import {
  applyControllerConflictProposal,
  applyControllerCoverageProposal,
  createEvidenceRuntimeLedger,
  evidenceLedgerObservation,
  recordVerifiedToolEvidence,
  recordVerifiedWebEvidence,
  type ControllerConflictProposal,
  type ControllerCoverageProposal,
  type EvidenceRuntimeLedger,
} from './runtimeLedger.ts'

export const EVIDENCE_CONTROLLER_SESSION_VERSION = 'evidence-controller-session-v2'

export interface EvidenceControllerSession {
  version: typeof EVIDENCE_CONTROLLER_SESSION_VERSION
  recordToolResult: (result: AssistantToolExecution) => void
  recordWebSources: (sources: readonly ReasoningSourceRef[]) => void
  applyCoverageProposal: (proposal: ControllerCoverageProposal) => void
  applyConflictProposal: (proposal: ControllerConflictProposal) => void
  observation: () => ReturnType<typeof evidenceLedgerObservation>
  snapshot: () => EvidenceRuntimeLedger
}

/**
 * Stateful adapter around the evidence ledger. Runtime may feed mechanically
 * verified observations into it, while semantic coverage/conflicts remain
 * explicit controller proposals constrained to evidence IDs already present.
 */
export const createEvidenceControllerSession = (question: string): EvidenceControllerSession => {
  let ledger = createEvidenceRuntimeLedger(question)

  return {
    version: EVIDENCE_CONTROLLER_SESSION_VERSION,
    recordToolResult(result) {
      ledger = recordVerifiedToolEvidence(ledger, result)
    },
    recordWebSources(sources) {
      ledger = recordVerifiedWebEvidence(ledger, sources)
    },
    applyCoverageProposal(proposal) {
      ledger = applyControllerCoverageProposal(ledger, proposal)
    },
    applyConflictProposal(proposal) {
      ledger = applyControllerConflictProposal(ledger, proposal)
    },
    observation() {
      return evidenceLedgerObservation(ledger)
    },
    snapshot() {
      return ledger
    },
  }
}
