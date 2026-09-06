export interface Gemini38GoldenScenario {
  id: `G38-${string}`
  name: string
  critical: boolean
  contract: string
}

export const GEMINI38_GOLDEN_SUITE: Gemini38GoldenScenario[] = [
  { id: 'G38-01', name: 'Simple chat', critical: false, contract: 'No unnecessary tool and concise final.' },
  { id: 'G38-02', name: 'Exact enterprise identifier', critical: true, contract: 'Controller selects relevant verified knowledge and no unsupported code.' },
  { id: 'G38-03', name: 'Follow-up continuity', critical: true, contract: 'Resolved subject and prior evidence survive follow-up without regex routing.' },
  { id: 'G38-04', name: 'No evidence', critical: true, contract: 'Fail closed instead of hallucinating enterprise facts.' },
  { id: 'G38-05', name: 'Web freshness', critical: false, contract: 'Controller-selected provider web sources enter evidence with URLs.' },
  { id: 'G38-06', name: 'Multimodal screenshot/PDF', critical: true, contract: 'Media part, normalized media source and evidence hash stay linked.' },
  { id: 'G38-07', name: 'Artifact create', critical: true, contract: 'Artifact contract executes, verifies and persists a file.' },
  { id: 'G38-08', name: 'Artifact revision', critical: true, contract: 'Revision invariants preserve non-target content.' },
  { id: 'G38-09', name: 'Function call strictness', critical: true, contract: 'Provider call id/name are exact and mismatch fails.' },
  { id: 'G38-10', name: 'Long context', critical: false, contract: 'Large context is controller-requested and bounded.' },
  { id: 'G38-11', name: 'Thinking LOW', critical: false, contract: 'User Fast mode maps to valid LOW.' },
  { id: 'G38-12', name: 'Thinking HIGH', critical: false, contract: 'User Deep mode maps to valid HIGH.' },
  { id: 'G38-13', name: 'Provider isolation', critical: true, contract: 'Explicit Gemini never silently falls back to OpenAI.' },
  { id: 'G38-14', name: 'Unsupported parameters', critical: true, contract: 'Gemini 3.8 builders omit unsupported legacy sampling fields.' },
  { id: 'G38-15', name: 'Multi-tool round', critical: true, contract: 'Parallel function calls and observations retain exact ids.' },
]
