import { describe, expect, it } from 'vitest';
import {
  createSafeStreamSink,
  type SafeStreamTimingObservation,
} from '../../../supabase/functions/_shared/safeStreamSink';

class FakeController {
  chunks: string[] = [];
  closed = false;
  failWrites = false;

  enqueue(chunk: Uint8Array) {
    if (this.closed || this.failWrites) throw new TypeError('The stream controller cannot close or enqueue');
    this.chunks.push(new TextDecoder().decode(chunk));
  }

  close() {
    if (this.closed || this.failWrites) throw new TypeError('The stream controller cannot close or enqueue');
    this.closed = true;
  }
}

describe('safe stream sink', () => {
  it('writes SSE events and terminates exactly once', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    expect(sink.event('status', { stage: 'answering' })).toBe(true);
    expect(sink.done()).toBe(true);
    expect(controller.closed).toBe(true);
    expect(controller.chunks.join('')).toContain('event: status');
    expect(controller.chunks.join('')).toContain('data: [DONE]');

    expect(sink.done()).toBe(false);
    expect(sink.close()).toBe(false);
    expect(sink.event('status', { stage: 'late' })).toBe(false);
  });

  it('turns a downstream disconnect into a no-op instead of throwing', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    controller.failWrites = true;
    expect(() => sink.event('text_delta', { delta: 'late chunk' })).not.toThrow();
    expect(sink.isOpen()).toBe(false);
    expect(sink.event('completed', {})).toBe(false);
    expect(sink.close()).toBe(false);
  });

  it('does not attempt close after the final DONE write itself detects disconnect', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller, new TextEncoder(), { logTiming: false });

    controller.failWrites = true;
    expect(sink.done()).toBe(false);
    expect(sink.isOpen()).toBe(false);
    expect(controller.closed).toBe(false);
  });

  it('observes the first non-empty text delta without calling it end-to-end TTFT', () => {
    const controller = new FakeController();
    let clock = 1_000;
    let observed: SafeStreamTimingObservation | undefined;
    const sink = createSafeStreamSink(controller, new TextEncoder(), {
      now: () => clock,
      logTiming: false,
      onTiming: timing => { observed = timing; },
    });

    clock = 1_050;
    sink.event('status', { type: 'status', stage: 'answering' });
    clock = 1_120;
    sink.event('text_delta', { type: 'text_delta', delta: '' });
    clock = 1_180;
    sink.event('text_delta', { type: 'text_delta', delta: 'Merhaba' });
    clock = 1_260;
    sink.event('completed', {
      type: 'completed',
      conversationId: 'conv-1',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      cached: false,
    });
    clock = 1_300;
    sink.done();

    expect(observed).toEqual({
      version: 'safe-stream-timing-v1',
      streamOpenedAtMs: 1_000,
      firstTextDeltaAtMs: 1_180,
      completedAtMs: 1_300,
      streamOpenToFirstTextMs: 180,
      streamTotalMs: 300,
      firstTextObserved: true,
      completedEventObserved: true,
      conversationId: 'conv-1',
      model: 'gpt-5.6-sol',
      provider: 'openai',
      cached: false,
    });
  });
});
