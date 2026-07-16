import { describe, expect, it } from 'vitest';
import { isWorkspaceResultCurrent } from '../workspaceRepository';

describe('workspace async result guard', () => {
  it('accepts results only for the active workspace', () => {
    expect(isWorkspaceResultCurrent('workspace-a', 'workspace-a')).toBe(true);
    expect(isWorkspaceResultCurrent('workspace-a', 'workspace-b')).toBe(false);
    expect(isWorkspaceResultCurrent('workspace-a', null)).toBe(false);
  });
});
