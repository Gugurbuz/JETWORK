import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { normalizeRuntimePersistenceState } from '../useMessageStore';

const runtimeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'assistant-1',
  role: 'model',
  text: 'CHECK_ZTKS sonucu',
  senderName: 'JetWork AI',
  senderRole: 'Sistem Asistanı',
  createdAt: 1,
  provider: 'gemini',
  responseModel: 'gemini-3.8-flash',
  ...overrides,
} as Message);

describe('Agent Work durable completion boundary', () => {
  it('keeps a successful runtime turn active while canonical chronology persistence is pending', () => {
    const normalized = normalizeRuntimePersistenceState(runtimeMessage({
      isTyping: false,
      persistenceStatus: 'pending',
    }));

    expect(normalized.isTyping).toBe(true);
  });

  it('allows the work header to complete after the durable message save succeeds', () => {
    const normalized = normalizeRuntimePersistenceState(runtimeMessage({
      isTyping: true,
      persistenceStatus: 'saved',
    }));

    expect(normalized.isTyping).toBe(false);
  });

  it('does not leave the work header active after a definitive persistence failure', () => {
    const normalized = normalizeRuntimePersistenceState(runtimeMessage({
      isTyping: true,
      persistenceStatus: 'failed',
    }));

    expect(normalized.isTyping).toBe(false);
  });

  it('does not rewrite ordinary or legacy assistant messages without runtime provider metadata', () => {
    const message = runtimeMessage({
      provider: undefined,
      isTyping: false,
      persistenceStatus: 'pending',
    });

    expect(normalizeRuntimePersistenceState(message)).toBe(message);
  });
});
