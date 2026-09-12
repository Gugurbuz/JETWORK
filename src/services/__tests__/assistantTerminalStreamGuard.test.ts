import { describe, expect, it, vi } from 'vitest';

import {
  closeOnAssistantTerminalEvent,
  isTerminalAssistantSseFrame,
} from '../assistantTerminalStreamGuard';

const encoder = new TextEncoder();

describe('assistantTerminalStreamGuard', () => {
  it.each([
    'event: completed\ndata: {"type":"completed","conversationId":"c1"}',
    'event: error\ndata: {"type":"error","message":"failed"}',
    'data: [DONE]',
    'data: {"type":"completed"}',
  ])('recognizes terminal frame: %s', frame => {
    expect(isTerminalAssistantSseFrame(frame)).toBe(true);
  });

  it('does not treat normal text or status frames as terminal', () => {
    expect(isTerminalAssistantSseFrame('event: text_delta\ndata: {"type":"text_delta","delta":"Merhaba"}')).toBe(false);
    expect(isTerminalAssistantSseFrame('event: status\ndata: {"type":"status","stage":"answering"}')).toBe(false);
  });

  it('closes the browser-facing stream immediately after completed even when upstream never reaches EOF', async () => {
    const upstreamCancelled = vi.fn();
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(
            'event: text_delta\ndata: {"type":"text_delta","delta":"Yanıt"}\n\n',
          ));
          controller.enqueue(encoder.encode(
            'event: completed\ndata: {"type":"completed","conversationId":"c1"}\n\n',
          ));
          // Production regression: transport stays open after the terminal frame.
          // Deliberately do not call controller.close().
        },
        cancel(reason) {
          upstreamCancelled(reason);
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

    const guarded = closeOnAssistantTerminalEvent(upstream);
    const result = await guarded.text();

    expect(result).toContain('event: text_delta');
    expect(result).toContain('event: completed');
    expect(upstreamCancelled).toHaveBeenCalledTimes(1);
  });

  it('passes through a normally closed non-terminal response', async () => {
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: text_delta\ndata: {"type":"text_delta","delta":"A"}\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );

    await expect(closeOnAssistantTerminalEvent(upstream).text()).resolves.toContain('text_delta');
  });
});
