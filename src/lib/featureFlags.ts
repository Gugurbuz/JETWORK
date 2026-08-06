const runtimeEnv = (
  (import.meta as any).env
  || (typeof process !== 'undefined' ? process.env : {})
  || {}
) as Record<string, string | undefined>;

/**
 * Runtime-backed features are enabled unless an environment explicitly sets
 * the flag to "false". This avoids silently falling back to the legacy
 * orchestrator when a Vercel environment variable is absent.
 */
export const isRuntimeFeatureEnabled = (value?: string): boolean => (
  String(value ?? 'true').trim().toLowerCase() !== 'false'
);

export const FEATURE_FLAGS = {
  ZERO_TOUCH: false,
  SINGLE_AGENT_MENTIONS: false,
  SINGLE_CHAT_ORCHESTRATOR: true,
  SINGLE_ASSISTANT_RUNTIME: isRuntimeFeatureEnabled(runtimeEnv.VITE_SINGLE_ASSISTANT_RUNTIME),
  DOCUMENT_COPILOT: true,
  SELECTED_TEXT_ACTIONS: true,
} as const;
