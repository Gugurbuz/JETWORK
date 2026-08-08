export interface FastPathSession {
  access_token?: string | null;
  expires_at?: number | null;
}

export interface SessionReadResult<TSession extends FastPathSession> {
  data: { session: TSession | null };
  error: unknown;
}

export interface AuthSessionFastPath<TSession extends FastPathSession> {
  remember: (session: TSession | null) => void;
  clear: () => void;
  peek: () => TSession | null;
  getSession: () => Promise<SessionReadResult<TSession>>;
}

const DEFAULT_MIN_VALIDITY_MS = 30_000;

/**
 * Keeps the latest Supabase session in memory and deduplicates the rare fallback
 * read/refresh. This prevents every assistant message from entering Supabase's
 * auth lock just to retrieve an access token that onAuthStateChange already gave us.
 */
export function createAuthSessionFastPath<TSession extends FastPathSession>(
  readSession: () => Promise<SessionReadResult<TSession>>,
  options: {
    minValidityMs?: number;
    now?: () => number;
  } = {},
): AuthSessionFastPath<TSession> {
  const minValidityMs = options.minValidityMs ?? DEFAULT_MIN_VALIDITY_MS;
  const now = options.now ?? Date.now;
  let cachedSession: TSession | null = null;
  let readInFlight: Promise<SessionReadResult<TSession>> | null = null;

  const isUsable = (session: TSession | null): session is TSession => {
    if (!session?.access_token) return false;
    if (typeof session.expires_at !== 'number') return true;
    return (session.expires_at * 1000) - now() > minValidityMs;
  };

  const remember = (session: TSession | null) => {
    cachedSession = session?.access_token ? session : null;
  };

  const getSession = async (): Promise<SessionReadResult<TSession>> => {
    if (isUsable(cachedSession)) {
      return { data: { session: cachedSession }, error: null };
    }

    if (!readInFlight) {
      readInFlight = readSession()
        .then(result => {
          if (!result.error) remember(result.data.session);
          return result;
        })
        .finally(() => {
          readInFlight = null;
        });
    }

    return readInFlight;
  };

  return {
    remember,
    clear: () => { cachedSession = null; },
    peek: () => isUsable(cachedSession) ? cachedSession : null,
    getSession,
  };
}
