# Agentic Semantic Authority Leak Fix

## Incident

Production turn `5eafa5ec-054b-4fb7-bc4b-6ef90bddc51e` showed `agent-controller-v2` telemetry but still received a legacy semantic evidence plan (`knowledgeRequired=true`, `enterpriseGroundingRequired=true`, `webMode=none`). The direct cause is production topology drift, not the intended repository V2 flow.

The deployed public `openai-assistant-v2` function is an ad-hoc Gemini 3.8 proxy that sends the raw user message directly to `assistant-primary-agent-core-canary`. It therefore bypasses the repository's semantic gateway, which would have attached the Controller V2 neutral advisory plan before entering the core. The core then falls back to legacy `routeReasoningRequest/buildReasoningPlan` for its advisory envelope; that envelope is supposed to be advisory, but `enterpriseGroundingRequired` is still consumed by the grounding boundary as a hard safety signal. In the failing turn this turned an old semantic classification into a real runtime constraint.

A second stale path also exists: deployed `openai-assistant-v2-internal` imports `openai-assistant-v2/index.ts` from Git commit `3dde3a3b0aac74ff7b36657e6931ffdb7a2dedc5`, hundreds of commits behind the materialized Agentic Runtime. It was not the primary path for the incident above, but it is an alternate semantic-authority leak and must be removed before rollout.

The same turn demonstrated a separate capability-surface leak: `provider:web_search` was absent from semantic Top-K, so `providerWebVisible=false` and the controller could not choose public web research even though the capability was active in the registry.

## Invariants

1. Controller V2 semantic preplanning is advisory context only. It does not choose knowledge, web, skill or artifact capabilities.
2. Production must enter the core through the canonical Controller V2 gateway path; a direct raw-message proxy to the core is not a valid Agentic Runtime topology.
3. No production Agent Controller V2 hop may import an old assistant runtime from an external immutable GitHub SHA.
4. Specialist Top-K may reduce specialist schemas, but it cannot remove foundational evidence domains from the controller's option set.
5. Foundational availability is not execution: web and knowledge tools remain controller-selected and normal authorization/grounding/tool guards still apply.
6. Search candidates are not evidence. Exact/detail verification remains required before candidate facts can ground final claims.
7. A grounding rejection before mechanical budget exhaustion is an observation for Controller V2 recovery, not a semantic routing decision.
8. Production rollout is blocked until unit/invariant tests, staging/live-like E2E, the original İYS regression, deployment-topology verification and grounding safety tests pass.

## Canonical production topology

Expected:

`client -> openai-assistant-v2-entry-router -> openai-assistant-v2-internal -> semantic gateway -> attachSemanticPlan(neutral V2 envelope) -> openai-assistant-core-v2 -> controller loop`

A production optimization may collapse transport hops only if it preserves the same contract: the core must receive the neutral Controller V2 envelope and no regex/legacy route may become semantic authority as a side effect.

Invalid:

`client -> ad-hoc model proxy -> core(raw user message) -> legacy planner fallback`

## Foundational evidence surface

The following capabilities remain available independently of embedding rank:

- `provider:web_search`
- `tool:search_knowledge_catalog`
- `tool:list_knowledge_catalog`
- `tool:get_knowledge_object`
- `tool:get_knowledge_objects`
- `tool:get_related_objects`

They are appended with a zero relevance score so they cannot masquerade as Top-K semantic matches. `excludeIds` is still honored during discover-more sessions.

## Original regression

Input:

`İYS entegrasyon dokümanına ihtiyacım var güncel`

Required behavior:

- The core receives a Controller V2 neutral advisory plan (`knowledgeRequired=false`, `webMode=none`) rather than deriving a semantic route from the raw phrase.
- Web and knowledge evidence capabilities are both available to the active LLM controller.
- The LLM chooses the next capability based on the goal and observations.
- Candidate-only knowledge search output cannot be used as verified evidence.
- A blocked grounded draft re-enters the controller loop while recovery budget remains; only terminal budget/no-evidence state may return the safe evidence-gap response.

## Rollout gate

Do not merge/deploy to production from this branch until:

1. CI typecheck/build/unit tests are green.
2. Staging Agent Controller V2 run passes the İYS regression and paraphrase variants.
3. Staging confirms `providerWebVisible=true` without a web keyword/regex route.
4. Staging verifies the core receives the neutral Controller V2 plan rather than a legacy fallback plan.
5. Deployed public gateway is not a raw-message direct-core semantic bypass.
6. Deployed internal gateway source is repository-local and contains no stale runtime pin.
7. Grounding safety and candidate-verification regression suites remain green.
8. Production canary is verified before full routing is changed.
