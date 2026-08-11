import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistantTextSmoother } from '../assistantTextSmoother';

afterEach(() => {
  vi.useRealTimers();
});

describe('createAssistantTextSmoother', () => {
  it('reveals a large single delta over multiple updates', () => {
    vi.useFakeTimers();
    const updates: string[] = [];
    const smoother = createAssistantTextSmoother({
      intervalMs: 20,
      onUpdate: text => updates.push(text),
    });

    smoother.push('Gemini cevabı ekrana yazılıyormuş gibi akar.');

    expect(updates).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(updates).toEqual(['Gemi']);
    vi.advanceTimersByTime(20);
    expect(updates.at(-1)).toBe('Gemini c');
    smoother.stop();
  });

  it('flushes to the final text before completion when the animation would run too long', async () => {
    vi.useFakeTimers();
    const updates: string[] = [];
    const smoother = createAssistantTextSmoother({
      intervalMs: 50,
      finishMaxWaitMs: 100,
      onUpdate: text => updates.push(text),
    });

    const finished = smoother.finish('x'.repeat(600));

    vi.advanceTimersByTime(100);
    await expect(finished).resolves.toBe('x'.repeat(600));
    expect(updates.at(-1)).toBe('x'.repeat(600));
    smoother.stop();
  });
});
