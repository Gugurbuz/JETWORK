export {
  TRIVIAL_FAST_PATH_ENGINE_VERSION,
  providerForTrivialFastPathModel,
  requestTrivialAssistantResponse,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/c5567c7de98ee37db40f4e9730275c6835581bad/supabase/functions/_shared/trivialAssistantFastPath.ts?primary-agent-disabled=1'

export const shouldUseTrivialAssistantFastPath = (_input: unknown): boolean => false
