import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('useMessages completed stream terminal policy', () => {
  const source = readFileSync(
    new URL('../../hooks/useMessages.ts', import.meta.url),
    'utf8',
  );

  it('records the backend completed event before local error handling', () => {
    expect(source).toContain('let completedSeen = false;');
    expect(source).toContain('onCompleted: () => {\n            completedSeen = true;');
  });

  it('does not emit a local error after completed when the remaining failure is transport-only', () => {
    const guardIndex = source.indexOf('const terminalTransportClose = completedSeen');
    const failedMessageIndex = source.indexOf('const failedMessage: Message = {', guardIndex);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(source.slice(guardIndex, failedMessageIndex)).toContain('isRecoverableAssistantTransportError(error)');
    expect(source.slice(guardIndex, failedMessageIndex)).toContain('if (terminalTransportClose)');
    expect(source.slice(guardIndex, failedMessageIndex)).toContain('return;');
    expect(failedMessageIndex).toBeGreaterThan(guardIndex);
  });
});
