import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  installStreamControllerLifecycleGuard,
  isClosedStreamControllerError,
} from '../../../supabase/functions/_shared/streamControllerGuard';

describe('stream controller lifecycle guard', () => {
  it('recognizes only terminal closed-controller lifecycle errors', () => {
    expect(isClosedStreamControllerError(
      new TypeError('The stream controller cannot close or enqueue'),
    )).toBe(true);
    expect(isClosedStreamControllerError(
      new TypeError('Controller is already closed'),
    )).toBe(true);
    expect(isClosedStreamControllerError(
      new TypeError('Unexpected provider decoding failure'),
    )).toBe(false);
    expect(isClosedStreamControllerError(
      new Error('The stream controller cannot close or enqueue'),
    )).toBe(false);
  });

  it('turns late enqueue/close after disconnect into no-ops and installs once', () => {
    class FakeReadableStreamDefaultController {
      mode: 'open' | 'closed' = 'open';
      writes = 0;
      closes = 0;

      enqueue(..._args: unknown[]) {
        if (this.mode === 'closed') {
          throw new TypeError('The stream controller cannot close or enqueue');
        }
        this.writes += 1;
      }

      close(..._args: unknown[]) {
        if (this.mode === 'closed') {
          throw new TypeError('The stream controller cannot close or enqueue');
        }
        this.closes += 1;
      }
    }

    const target = { ReadableStreamDefaultController: FakeReadableStreamDefaultController };
    expect(installStreamControllerLifecycleGuard(target)).toBe(true);
    expect(installStreamControllerLifecycleGuard(target)).toBe(false);

    const controller = new FakeReadableStreamDefaultController();
    controller.enqueue(new Uint8Array([1]));
    expect(controller.writes).toBe(1);

    controller.mode = 'closed';
    expect(() => controller.enqueue(new Uint8Array([2]))).not.toThrow();
    expect(() => controller.close()).not.toThrow();
    expect(controller.writes).toBe(1);
    expect(controller.closes).toBe(0);
  });

  it('does not hide unrelated stream/runtime errors', () => {
    class FakeReadableStreamDefaultController {
      enqueue(..._args: unknown[]) {
        throw new TypeError('Provider stream decoder exploded');
      }
      close(..._args: unknown[]) {
        throw new TypeError('Provider stream decoder exploded');
      }
    }

    const target = { ReadableStreamDefaultController: FakeReadableStreamDefaultController };
    expect(installStreamControllerLifecycleGuard(target)).toBe(true);
    const controller = new FakeReadableStreamDefaultController();

    expect(() => controller.enqueue()).toThrow('Provider stream decoder exploded');
    expect(() => controller.close()).toThrow('Provider stream decoder exploded');
  });
});

describe('runtime stream stabilization wiring', () => {
  it('installs the lifecycle guard before loading the durable reasoning implementation', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-core-v2/index.ts', import.meta.url),
      'utf8',
    );
    const installIndex = source.indexOf('installStreamControllerLifecycleGuard()');
    const implementationIndex = source.indexOf("await import('./implementation.ts')");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(implementationIndex).toBeGreaterThan(installIndex);
  });

  it('guards the semantic gateway fast path before loading its implementation', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-semantic-v2/index.ts', import.meta.url),
      'utf8',
    );
    const installIndex = source.indexOf('installStreamControllerLifecycleGuard()');
    const implementationIndex = source.indexOf("await import('../openai-assistant-v2/index.ts')");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(implementationIndex).toBeGreaterThan(installIndex);
  });
});
