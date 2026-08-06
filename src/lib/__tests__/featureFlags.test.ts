import { describe, expect, it } from 'vitest';
import { isRuntimeFeatureEnabled } from '../featureFlags';

describe('isRuntimeFeatureEnabled', () => {
  it('enables the runtime when the environment value is missing', () => {
    expect(isRuntimeFeatureEnabled(undefined)).toBe(true);
    expect(isRuntimeFeatureEnabled('')).toBe(true);
  });

  it('keeps explicit true values enabled', () => {
    expect(isRuntimeFeatureEnabled('true')).toBe(true);
    expect(isRuntimeFeatureEnabled(' TRUE ')).toBe(true);
  });

  it('allows an explicit false value to disable the runtime', () => {
    expect(isRuntimeFeatureEnabled('false')).toBe(false);
    expect(isRuntimeFeatureEnabled(' FALSE ')).toBe(false);
  });
});
