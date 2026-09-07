import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { mergeRuntimeServerMessage, normalizeRuntimePersistenceState } from '../useMessageStore';

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

  it('allows completion when the realtime durable row has redacted provider metadata', () => {
    const normalized = normalizeRuntimePersistenceState(runtimeMessage({
      provider: undefined,
      responseModel: undefined,
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

  it('does not rewrite ordinary or legacy assistant messages without runtime provider metadata while pending', () => {
    const message = runtimeMessage({
      provider: undefined,
      isTyping: false,
      persistenceStatus: 'pending',
    });

    expect(normalizeRuntimePersistenceState(message)).toBe(message);
  });

  it('keeps an optimistic active assistant stream alive when the server materializer emits the same id first', () => {
    const local = runtimeMessage({
      provider: undefined,
      responseModel: undefined,
      text: 'Findeks kayıtları inceleniyor...',
      thinkingText: 'Bilgi bankasında kayıtları inceliyorum...',
      phase: 'RESEARCH',
      phaseLabel: 'Bilgi bankasında aranıyor...',
      isTyping: true,
      persistenceStatus: undefined,
      createdAt: 100,
    });
    const serverMaterialized = runtimeMessage({
      text: 'Sunucu tarafından materialize edilen final metin',
      isTyping: false,
      persistenceStatus: undefined,
      createdAt: 200,
      thinkingText: undefined,
      phase: null,
      phaseLabel: undefined,
      workEvents: undefined,
      rawResponse: undefined,
    });

    const merged = mergeRuntimeServerMessage(local, serverMaterialized);

    expect(merged.text).toBe('Sunucu tarafından materialize edilen final metin');
    expect(merged.isTyping).toBe(true);
    expect(merged.persistenceStatus).toBe('pending');
    expect(merged.createdAt).toBe(100);
    expect(merged.thinkingText).toBe('Bilgi bankasında kayıtları inceliyorum...');
    expect(merged.phase).toBe('RESEARCH');
  });

  it('lets a server row carrying canonical Agent Work events complete the same active stream', () => {
    const local = runtimeMessage({
      isTyping: true,
      persistenceStatus: 'pending',
    });
    const serverDurable = runtimeMessage({
      isTyping: false,
      persistenceStatus: undefined,
      workEvents: [{
        eventId: 'tool:1',
        sequence: 1,
        kind: 'tool',
        label: 'Bilgi bankası sorgusu tamamlandı',
        sourceType: 'knowledge',
        state: 'completed',
      }],
    });

    const merged = mergeRuntimeServerMessage(local, serverDurable);

    expect(merged.isTyping).toBe(false);
    expect(merged.persistenceStatus).toBe('saved');
    expect(merged.workEvents?.[0]?.eventId).toBe('tool:1');
  });
});
