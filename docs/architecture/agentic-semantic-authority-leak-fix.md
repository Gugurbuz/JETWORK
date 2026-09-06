# Agentic Semantic Authority Leak Fix

## Incident

Production turn `5eafa5ec-054b-4fb7-bc4b-6ef90bddc51e` showed Agent Controller V2 telemetry while a stale internal semantic gateway still produced a legacy evidence plan. The deployed `openai-assistant-v2-internal` function imported `openai-assistant-v2/index.ts` from Git commit `3dde3a3b0aac74ff7b36657e6931ffdb7a2dedc5`, hundreds of commits behind the materialized Agentic Runtime.

The same turn also demonstrated a second authority leak: `provider:web_search` was absent from semantic Top-K, so `providerWebVisible=false` and the controller could not choose public web research even though the capability was active in the registry.

## Invariants

1. Controller V2 semantic preplanning is advisory context only. It does not choose knowledge, web, skill or artifact capabilities.
2. No production Agent Controller V2 hop may import an old assistant runtime from an external immutable GitHub SHA.
3. Specialist Top-K may reduce specialist schemas, but it cannot remove foundational evidence domains from the controller's option set.
4. Foundational availability is not execution: web and knowledge tools remain controller-selected and normal authorization/grounding/tool guards still apply.
5. Search candidates are not evidence. Exact/detail verification remains required before candidate facts can ground final claims.
6. Production rollout is blocked until unit/invariant tests, staging/live-like E2E, the original İYS regression, and deployment-source verification pass.

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

- Controller V2 advisory plan stays semantically neutral (`knowledgeRequired=false`, `webMode=none`).
- Web and knowledge evidence capabilities are both available to the active LLM controller.
- The LLM chooses the next capability based on the goal and observations.
- Candidate-only knowledge search output cannot be used as verified evidence.
- A final answer is grounded in verified evidence or explicitly states the remaining evidence gap after recovery budget is exhausted.

## Rollout gate

Do not merge/deploy to production from this branch until:

1. CI typecheck/build/unit tests are green.
2. Staging Agent Controller V2 run passes the İYS regression and paraphrase variants.
3. Staging confirms `providerWebVisible=true` without a web keyword/regex route.
4. Deployed internal gateway source is repository-local and contains no `raw.githubusercontent.com` runtime pin.
5. Grounding safety regression suite remains green.
6. Production canary is verified before full routing is changed.
