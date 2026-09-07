import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../AssistantWorkIndicator.tsx', import.meta.url), 'utf8');
const hookSource = source.slice(
  source.indexOf('function useComposerStopTarget'),
  source.indexOf('export function AssistantWorkIndicator'),
);

describe('AssistantWorkIndicator stop portal lifecycle', () => {
  it('does not subscribe the portal effect to the unstable onStop callback identity', () => {
    expect(source).toContain('function useComposerStopTarget(isActive: boolean, hasStopHandler: boolean)');
    expect(source).toContain('useComposerStopTarget(isActive, Boolean(onStop))');
    expect(hookSource).toContain('[hasStopHandler, isActive]');
    expect(hookSource).not.toContain('[isActive, onStop]');
  });

  it('restores the send button without scheduling a state update from effect cleanup', () => {
    const cleanup = hookSource.slice(hookSource.indexOf('return () => {'));
    expect(cleanup).toContain('sendButton.style.display = previousDisplay');
    expect(cleanup).not.toContain('setTarget(null)');
  });
});
