const runtimeEnv = (
  (import.meta as any).env
  || (typeof process !== 'undefined' ? process.env : {})
  || {}
) as Record<string, string | undefined>;

export const FEATURE_FLAGS = {
  ZERO_TOUCH: false,
  SINGLE_AGENT_MENTIONS: false,
  SINGLE_CHAT_ORCHESTRATOR: true,
  SINGLE_ASSISTANT_RUNTIME: String(runtimeEnv.VITE_SINGLE_ASSISTANT_RUNTIME || '').toLowerCase() === 'true',
  DOCUMENT_COPILOT: true,
  SELECTED_TEXT_ACTIONS: true,
} as const;
