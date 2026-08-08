export interface AuthIdentity {
  uid: string;
}

export interface AuthBootstrapCoordinator<T extends AuthIdentity> {
  handleAuthEvent: (user: T | null) => void;
  handleSessionSnapshot: (user: T | null) => void;
  hasObservedAuthEvent: () => boolean;
}

/**
 * Coordinates Supabase auth events with the one-off getSession bootstrap read.
 * Once a realtime auth event is observed it becomes authoritative, so a slower
 * session snapshot cannot overwrite it. Repeated events for the same identity
 * are deduplicated to avoid duplicate profile hydration on token refresh.
 */
export function createAuthBootstrapCoordinator<T extends AuthIdentity>(
  callback: (user: T | null) => void,
): AuthBootstrapCoordinator<T> {
  let authEventObserved = false;
  let lastEmittedUid: string | null | undefined;

  const emitIfChanged = (user: T | null) => {
    const nextUid = user?.uid ?? null;
    if (lastEmittedUid === nextUid) return;
    lastEmittedUid = nextUid;
    callback(user);
  };

  return {
    handleAuthEvent(user) {
      authEventObserved = true;
      emitIfChanged(user);
    },
    handleSessionSnapshot(user) {
      if (authEventObserved) return;
      emitIfChanged(user);
    },
    hasObservedAuthEvent() {
      return authEventObserved;
    },
  };
}
