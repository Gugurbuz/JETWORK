import { describe, expect, it } from 'vitest';
import { shouldHoldAgentWorkCompletionForPersistence } from '../agentWorkCompletionBarrier';

describe('Agent Work durable completion barrier', () => {
  it('holds completion after live canonical events until a durable snapshot exists', () => {
    expect(shouldHoldAgentWorkCompletionForPersistence({
      isActive: false,
      canonicalSeen: true,
      durableEventsAvailable: false,
    })).toBe(true);
  });

  it('releases completion once persisted or hydrated canonical events exist', () => {
    expect(shouldHoldAgentWorkCompletionForPersistence({
      isActive: false,
      canonicalSeen: true,
      durableEventsAvailable: true,
    })).toBe(false);
  });

  it('does not hold legacy completed messages that never had canonical events', () => {
    expect(shouldHoldAgentWorkCompletionForPersistence({
      isActive: false,
      canonicalSeen: false,
      durableEventsAvailable: false,
    })).toBe(false);
  });

  it('does not relabel an explicitly stopped turn as active while persistence finishes', () => {
    expect(shouldHoldAgentWorkCompletionForPersistence({
      isActive: false,
      canonicalSeen: true,
      durableEventsAvailable: false,
      isStopped: true,
    })).toBe(false);
  });
});
