import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceConversationPath,
  isWorkspaceConversationPath,
  parseWorkspaceIdFromPath,
} from '../workspaceRoute';

describe('workspace conversation routes', () => {
  it('builds and parses a durable conversation path', () => {
    const workspaceId = '1966c995-360e-493e-b6ae-91b4524cf220';
    const path = buildWorkspaceConversationPath(workspaceId);

    expect(path).toBe(`/c/${workspaceId}`);
    expect(parseWorkspaceIdFromPath(path)).toBe(workspaceId);
    expect(isWorkspaceConversationPath(path)).toBe(true);
  });

  it('accepts a trailing slash and decodes safe identifiers', () => {
    expect(parseWorkspaceIdFromPath('/c/demo%20workspace/')).toBe('demo workspace');
  });

  it.each(['/', '/projects', '/c/', '/c/a/extra'])('keeps non-conversation paths out of workspace routing: %s', path => {
    expect(parseWorkspaceIdFromPath(path)).toBeNull();
    expect(isWorkspaceConversationPath(path)).toBe(false);
  });

  it('returns home for an empty workspace id', () => {
    expect(buildWorkspaceConversationPath('   ')).toBe('/');
  });
});
