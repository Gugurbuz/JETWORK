export interface AgentWorkCompletionBarrierInput {
  isActive: boolean;
  canonicalSeen: boolean;
  durableEventsAvailable: boolean;
  isStopped?: boolean;
}

/**
 * A streamed Agent Work chronology is not durable merely because the provider
 * finished. Keep the public work header in its active state until the canonical
 * chronology has either been hydrated from the message or registered after the
 * assistant-message upsert succeeds.
 *
 * This prevents the UI from advertising completion during the small but real
 * window where a reload would discard the canonical event ids and reconstruct
 * reported:/observed: compatibility rows instead.
 */
export const shouldHoldAgentWorkCompletionForPersistence = (
  input: AgentWorkCompletionBarrierInput,
): boolean => (
  !input.isActive
  && input.canonicalSeen
  && !input.durableEventsAvailable
  && input.isStopped !== true
);
