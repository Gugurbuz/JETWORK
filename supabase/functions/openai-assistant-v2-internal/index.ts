// Internal semantic gateway used by the public Agent Controller V2 entry router.
//
// IMPORTANT: keep this as a repository-local import. The previously deployed
// function imported openai-assistant-v2 from an old immutable GitHub SHA, which
// allowed a stale legacy semantic planner to remain in the live path after the
// public router had already selected Agent Controller V2. Local bundling makes
// the gateway, runtime flags and semantic orchestrator one release unit.
import '../openai-assistant-v2/index.ts'
