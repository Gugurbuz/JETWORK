import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'vitest';

describe('temporary stream lifecycle CI diagnostic', () => {
  it('prints the injected lifecycle contract when present', () => {
    const path = 'src/services/__tests__/useMessagesStreamLifecycle.test.ts';
    if (!existsSync(path)) {
      console.log('STREAM_LIFECYCLE_DIAGNOSTIC: injected test not present in checkout');
      return;
    }
    console.log('STREAM_LIFECYCLE_DIAGNOSTIC_BEGIN');
    console.log(readFileSync(path, 'utf8'));
    console.log('STREAM_LIFECYCLE_DIAGNOSTIC_END');
  });
});
