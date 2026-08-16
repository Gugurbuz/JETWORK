import { describe, expect, it } from 'vitest';
import { isRecoverableAssistantTransportError } from '../assistantRuntimeRecovery';

describe('assistant runtime transport recovery', () => {
  it.each([
    new Error('Load failed'),
    new Error('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    new Error('Connection closed unexpectedly'),
    new Error('Asistan bağlantısı yanıt tamamlanmadan kesildi.'),
  ])('classifies recoverable transport closure: %s', error => {
    expect(isRecoverableAssistantTransportError(error)).toBe(true);
  });

  it('does not classify user abort or business/runtime failures as transport recovery', () => {
    expect(isRecoverableAssistantTransportError(new DOMException('Aborted', 'AbortError'))).toBe(false);
    expect(isRecoverableAssistantTransportError(new Error('Artifact doğrulaması başarısız oldu.'))).toBe(false);
    expect(isRecoverableAssistantTransportError(new Error('Provider returned invalid JSON.'))).toBe(false);
  });
});
