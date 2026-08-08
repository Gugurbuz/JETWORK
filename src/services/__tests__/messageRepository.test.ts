import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../types';

const { fromMock, upsertMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    from: fromMock,
  },
}));

import { saveAiMessage } from '../messageRepository';

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'assistant-1',
  role: 'model',
  text: 'Tamam',
  senderName: 'JetWork AI',
  senderRole: 'Sistem Asistanı',
  createdAt: 1_786_187_000_000,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue({ error: null });
  fromMock.mockReturnValue({ upsert: upsertMock });
});

describe('messageRepository retry persistence', () => {
  it('explicitly clears stale error state after a successful retry', async () => {
    await saveAiMessage('workspace-1', 'owner-1', baseMessage({
      text: "BA Analiz dokümanı oluşturuldu ve Canvas'a v1 olarak kaydedildi.",
    }));

    expect(fromMock).toHaveBeenCalledWith('messages');
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'assistant-1',
      workspace_id: 'workspace-1',
      is_error: false,
      retry_payload: null,
    }));
  });

  it('keeps retry metadata when the assistant message is still an error', async () => {
    await saveAiMessage('workspace-1', 'owner-1', baseMessage({
      text: 'Tekrar deneyin.',
      isError: true,
      retryPayload: {
        text: 'Dokümanı oluştur',
        messageId: 'user-1',
        assistantMessageId: 'assistant-1',
        attachments: [],
      },
    }));

    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
      is_error: true,
      retry_payload: expect.objectContaining({
        text: 'Dokümanı oluştur',
        messageId: 'user-1',
        assistantMessageId: 'assistant-1',
      }),
    }));
  });
});
