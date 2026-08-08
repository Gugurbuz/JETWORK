import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}));

import {
  AssistantAttachmentValidationError,
  parseAssistantRuntimeEvent,
  prepareAssistantChatAttachments,
  streamAssistantResponse,
} from '../assistantRuntimeClient';

const encodeBase64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, byte => String.fromCodePoint(byte)).join(''));
};

const sseResponse = (frames: string[]) => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      frames.forEach(frame => controller.enqueue(encoder.encode(frame)));
      controller.close();
    },
  }),
  {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  },
);

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('VITE_REASONING_ENGINE_V2', 'true');
  getSessionMock.mockResolvedValue({
    data: { session: { access_token: 'access-token' } },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('parseAssistantRuntimeEvent', () => {
  it('parses streamed text deltas', () => {
    expect(parseAssistantRuntimeEvent({
      event: 'text_delta',
      data: JSON.stringify({ delta: 'Merhaba' }),
    })).toEqual({
      type: 'text_delta',
      delta: 'Merhaba',
    });
  });

  it('normalizes corporate knowledge sources', () => {
    expect(parseAssistantRuntimeEvent({
      event: 'sources',
      data: JSON.stringify({
        sources: [
          {
            sourceId: 'source-1',
            sourceName: 'CRM Metot Arşivi',
            canonicalKey: 'method:zcl_crm/save',
            objectType: 'method',
            title: 'SAVE',
          },
          { sourceName: '' },
        ],
      }),
    })).toEqual({
      type: 'sources',
      sources: [{
        sourceId: 'source-1',
        sourceName: 'CRM Metot Arşivi',
        canonicalKey: 'method:zcl_crm/save',
        objectType: 'method',
        title: 'SAVE',
        sourceType: 'knowledge',
        url: undefined,
      }],
    });
  });

  it('preserves web source URLs for visible grounding', () => {
    expect(parseAssistantRuntimeEvent({
      event: 'sources',
      data: JSON.stringify({
        sources: [{
          sourceName: 'OpenAI Docs',
          title: 'Web search guide',
          sourceType: 'web',
          url: 'https://platform.openai.com/docs/guides/tools-web-search',
        }],
      }),
    })).toEqual({
      type: 'sources',
      sources: [{
        sourceName: 'OpenAI Docs',
        title: 'Web search guide',
        sourceType: 'web',
        url: 'https://platform.openai.com/docs/guides/tools-web-search',
      }],
    });
  });

  it.each([
    'routing',
    'planning',
    'searching_knowledge',
    'searching_web',
    'verifying',
    'synthesizing',
    'answering',
  ] as const)('parses %s status events', stage => {
    expect(parseAssistantRuntimeEvent({
      event: 'status',
      data: JSON.stringify({ stage, label: `stage:${stage}` }),
    })).toEqual({
      type: 'status',
      stage,
      label: `stage:${stage}`,
    });
  });

  it('parses completion metadata and done frames', () => {
    expect(parseAssistantRuntimeEvent({
      event: 'completed',
      data: JSON.stringify({
        conversationId: 'conversation-1',
        model: 'gpt-5.6-sol',
        usage: { input_tokens: 12, output_tokens: 8, ignored: 'x' },
      }),
    })).toEqual({
      type: 'completed',
      conversationId: 'conversation-1',
      model: 'gpt-5.6-sol',
      usage: { input_tokens: 12, output_tokens: 8 },
    });
    expect(parseAssistantRuntimeEvent({ data: '[DONE]' })).toEqual({ type: 'done' });
  });

  it('ignores malformed or unknown events', () => {
    expect(parseAssistantRuntimeEvent({ data: 'not-json' })).toBeNull();
    expect(parseAssistantRuntimeEvent({
      event: 'unknown',
      data: JSON.stringify({ value: true }),
    })).toBeNull();
  });
});

describe('prepareAssistantChatAttachments', () => {
  it('decodes only chat-scoped attachment text', async () => {
    await expect(prepareAssistantChatAttachments([
      {
        url: '',
        data: encodeBase64('Merhaba\r\nDünya'),
        mimeType: 'text/plain',
        name: 'not.txt',
        purpose: 'chat_only',
      },
      {
        url: '',
        data: encodeBase64('Kalıcı kaynak'),
        mimeType: 'text/markdown',
        name: 'source.md',
        purpose: 'knowledge_bank',
      },
    ])).resolves.toEqual([{
      name: 'not.txt',
      mimeType: 'text/plain',
      content: 'Merhaba\nDünya',
    }]);
  });

  it('rejects attachment count and content limits instead of silently truncating', async () => {
    const attachment = {
      url: '',
      data: encodeBase64('x'),
      mimeType: 'text/plain',
      name: 'note.txt',
      purpose: 'chat_only' as const,
    };
    await expect(prepareAssistantChatAttachments([
      attachment,
      attachment,
      attachment,
      attachment,
    ])).rejects.toBeInstanceOf(AssistantAttachmentValidationError);

    await expect(prepareAssistantChatAttachments([{
      ...attachment,
      data: encodeBase64('x'.repeat(60_001)),
    }])).rejects.toThrow('60.000');
  });
});

describe('streamAssistantResponse', () => {
  it('targets reasoning engine v2 by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'event: text_delta\ndata: {"delta":"Tamam"}\n\n',
      'event: completed\ndata: {"conversationId":"conversation-1","model":"gpt-5.6-sol"}\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    await streamAssistantResponse({
      workspaceId: 'workspace-1',
      messageId: 'message-1',
      message: 'Test',
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/functions/v1/openai-assistant-v2');
  });

  it('accepts the committed completed event even if the optional DONE frame is lost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: text_delta\ndata: {"delta":"Tamam"}\n\n',
      'event: completed\ndata: {"conversationId":"conversation-1","model":"gpt-5.6-sol"}\n\n',
    ])));

    await expect(streamAssistantResponse({
      workspaceId: 'workspace-1',
      messageId: 'message-1',
      message: 'Test',
    })).resolves.toMatchObject({
      text: 'Tamam',
      conversationId: 'conversation-1',
      model: 'gpt-5.6-sol',
    });
  });

  it('rejects a truncated stream without a completed event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: text_delta\ndata: {"delta":"Yarım"}\n\n',
    ])));

    await expect(streamAssistantResponse({
      workspaceId: 'workspace-1',
      messageId: 'message-1',
      message: 'Test',
    })).rejects.toThrow('tamamlanmadan kesildi');
  });
});
