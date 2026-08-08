import { describe, expect, it } from 'vitest';
import { createSafeStreamSink } from '../../../supabase/functions/_shared/safeStreamSink';

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
    const sink = createSafeStreamSink(controller);

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
    const sink = createSafeStreamSink(controller);

    controller.failWrites = true;
    expect(() => sink.event('text_delta', { delta: 'late chunk' })).not.toThrow();
    expect(sink.isOpen()).toBe(false);
    expect(sink.event('completed', {})).toBe(false);
    expect(sink.close()).toBe(false);
  });

  it('does not attempt close after the final DONE write itself detects disconnect', () => {
    const controller = new FakeController();
    const sink = createSafeStreamSink(controller);

    controller.failWrites = true;
    expect(sink.done()).toBe(false);
    expect(sink.isOpen()).toBe(false);
    expect(controller.closed).toBe(false);
  });
});
