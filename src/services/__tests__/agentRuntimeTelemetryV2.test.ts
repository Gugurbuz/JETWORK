import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_TELEMETRY_VERSION,
  createRuntimeTelemetryTracker,
} from '../../../supabase/functions/_shared/runtime/telemetry.ts'

describe('agent runtime telemetry v2', () => {
  it('produces the P7 latency breakdown without changing runtime behavior', () => {
    const tracker = createRuntimeTelemetryTracker()
    tracker.mark('request_received', 0)
    tracker.mark('turn_claimed', 100)
    tracker.mark('context_resolved', 250)
    tracker.mark('capability_discovery_completed', 400)
    tracker.mark('controller_first_decision', 650)
    tracker.recordToolLatency('search_knowledge_catalog', 900)
    tracker.recordToolLatency('search_knowledge_catalog', 700)
    tracker.mark('final_generation_started', 1800)
    tracker.mark('first_text_delta', 1950)
    tracker.mark('completed', 2600)

    expect(tracker.snapshot()).toEqual({
      version: AGENT_RUNTIME_TELEMETRY_VERSION,
      requestToClaimMs: 100,
      claimToContextMs: 150,
      contextToCapabilityDiscoveryMs: 150,
      capabilityDiscoveryLatencyMs: 150,
      contextToControllerFirstDecisionMs: 400,
      finalGenerationStartMs: 1800,
      firstTextDeltaTtftMs: 1950,
      generationToFirstTextDeltaMs: 150,
      streamDurationMs: 650,
      totalTurnMs: 2600,
      toolLatencyMs: { search_knowledge_catalog: [900, 700] },
    })
  })

  it('keeps missing timing stages null instead of inventing measurements', () => {
    const tracker = createRuntimeTelemetryTracker()
    tracker.mark('request_received', 10)
    tracker.mark('completed', 100)
    tracker.recordToolLatency('bad', -5)

    const snapshot = tracker.snapshot()
    expect(snapshot.totalTurnMs).toBe(90)
    expect(snapshot.requestToClaimMs).toBeNull()
    expect(snapshot.finalGenerationStartMs).toBeNull()
    expect(snapshot.firstTextDeltaTtftMs).toBeNull()
    expect(snapshot.generationToFirstTextDeltaMs).toBeNull()
    expect(snapshot.streamDurationMs).toBeNull()
    expect(snapshot.toolLatencyMs).toEqual({})
  })
})
