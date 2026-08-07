const CONVERSATION_PREFIX = '/c/';

export function buildWorkspaceConversationPath(workspaceId: string): string {
  const normalized = workspaceId.trim();
  if (!normalized) return '/';
  return `${CONVERSATION_PREFIX}${encodeURIComponent(normalized)}`;
}

export function parseWorkspaceIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!match) return null;

  try {
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded && decoded.length <= 200 ? decoded : null;
  } catch {
    return null;
  }
}

export function isWorkspaceConversationPath(pathname: string): boolean {
  return parseWorkspaceIdFromPath(pathname) !== null;
}
