# Agentic Semantic Authority Leak Fix

## Incident

Production turn `5eafa5ec-054b-4fb7-bc4b-6ef90bddc51e` showed Agent Controller V2 telemetry while the deployed assistant topology still allowed legacy semantic authority to leak back into the turn.

Three independent defects were confirmed:

1. Production `openai-assistant-v2` was an ad-hoc Gemini 3.8 proxy that forwarded the raw user message directly to `assistant-primary-agent-core-canary`, bypassing the repository semantic gateway and its neutral Controller V2 advisory envelope.
2. The alternate deployed `openai-assistant-v2-internal` path imported `openai-assistant-v2/index.ts` from legacy Git commit `3dde3a3b0aac74ff7b36657e6931ffdb7a2dedc5`.
3. Semantic Top-K could omit `provider:web_search` and foundational knowledge evidence tools, so the active LLM controller could lose a valid capability before it had the opportunity to choose it.

The same staging investigation exposed a deployment-topology defect: JETWORK must not depend on anonymous `raw.githubusercontent.com` imports for private-repository Edge runtime code. Supabase staging returned `Module not found` for the private SHA import. Runtime deployment therefore has to materialize the repository source into the Edge deployment package/bundle instead of treating a private GitHub raw URL as a durable module host.

## Invariants

1. Controller V2 semantic preplanning is advisory context only. It does not choose knowledge, web, skill or artifact capabilities.
2. Production must enter the core through the canonical Controller V2 gateway contract; a direct raw-message proxy to the core is not a valid Agentic Runtime topology.
3. No production Agent Controller V2 hop may import an old assistant runtime from an external immutable GitHub SHA.
4. No production Agent Controller V2 hop may depend on an anonymous private-repository `raw.githubusercontent.com` module import.
5. Specialist Top-K may reduce specialist schemas, but it cannot remove foundational evidence domains from the controller's option set.
6. Foundational availability is not execution: web and knowledge tools remain controller-selected and normal authorization/grounding/tool guards still apply.
7. Search candidates are not evidence. Exact/detail verification remains required before candidate facts can ground final claims.
8. If a provider attempts an enterprise-grounded final before enough verified evidence exists and mechanical budget remains, the unsafe draft is withheld and the same controller receives a grounding-recovery observation. The runtime does not pick the next semantic capability for it.
9. Terminal grounding remains fail-closed after the allowed recovery/re-plan budget is exhausted.
10. Production rollout is blocked until deterministic CI, the original İYS live-like regression, deployment-source/topology verification and grounding/candidate-verification safety gates pass.

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

## Core bypass defense

The canonical gateway must attach the neutral Controller V2 semantic envelope before entering the reasoning core. A second defense also exists in the core: while Controller V2 is active, absence of that envelope may not fall back to the legacy semantic planner. The core creates the same neutral controller envelope mechanically and leaves semantic capability selection to the active LLM.

This is a topology/safety fallback, not a second planner.

## Grounding recovery

For an enterprise-grounded turn, a provider draft that cannot be grounded is not immediately exposed to the user while recovery budget remains. The provider/controller receives a runtime observation describing the evidence gap and is allowed one controller re-plan using the normal capability surface. The observation does not contain a hard-coded instruction to call web, knowledge or a particular tool.

If the controller still cannot produce a supported final after recovery budget is exhausted, the existing fail-closed grounding response remains authoritative.

## Original regression

Input:

`İYS entegrasyon dokümanına ihtiyacım var güncel`

Required behavior:

- Controller V2 advisory plan stays semantically neutral (`knowledgeRequired=false`, `webMode=none`).
- Web and knowledge evidence capabilities are both available to the active LLM controller.
- The LLM chooses the next capability based on the goal and observations.
- Candidate-only knowledge search output cannot be used as verified evidence.
- Current-information claims require a fresh source when the controller chooses current web research.
- A final answer is grounded in verified evidence or explicitly states the remaining evidence gap after recovery budget is exhausted.
- A generic grounding failure must not be emitted prematurely while a valid controller recovery/re-plan remains available.

Freshness paraphrases are regression-covered so the invariant does not depend on the literal word `güncel`.

## Staging deployment packaging

The staging workflow materializes three private-repository runtime bundles:

- public entry/router bundle
- internal semantic-gateway bundle
- core runtime bundle

The bundle gate rejects `raw.githubusercontent.com/Gugurbuz/JETWORK` references in the generated runtime artifacts. This validates that the desired Edge deployment payload is self-contained with respect to private JETWORK source.

A focused staging runner also exists for the exact İYS regression. It verifies:

- `x-jetwork-runtime-route = agent-controller-v2`
- completed payload reports `controllerMode=true`
- explicit `gemini-3.8-flash` is preserved
- user-visible answer is produced
- at least one real HTTPS web source exists for this current-web golden scenario
- no premature generic grounding failure is surfaced

The live provider run requires the permanent isolated staging user token. The workflow records missing staging credentials as an environment block rather than misclassifying it as a product regression.

## Current verification status

At the latest PR #212 hardening pass:

- deterministic CI is green on the semantic-authority implementation;
- materialized runtime bundle generation is green and rejects private GitHub raw imports;
- the exact İYS scenario is present in the P6 golden contract;
- the focused live-like runner is implemented;
- unauthenticated staging gateway access remains correctly rejected with HTTP 401;
- a gzip/data-URL module loader was proven in isolated staging and the temporary diagnostic was disabled immediately afterwards;
- the materialized public staging entry/router bundle has been deployed with JWT verification preserved; internal/core staging transport is intentionally not claimed complete until the materialized bundle deployment is fully verified;
- live İYS provider execution remains blocked until `AGENTIC_GOLDEN_ANON_KEY` and `AGENTIC_GOLDEN_ACCESS_TOKEN` are available to the manual staging workflow.

This environment block does **not** satisfy the live release gate. Production must remain unchanged until the authenticated staging run passes.

## Rollout gate

Do not merge/deploy to production from this branch until:

1. CI typecheck/build/unit/golden tests are green on the final head SHA.
2. Materialized Edge deployment artifacts contain no private JETWORK raw runtime import.
3. The full public/internal/core materialized bundle topology is verified in staging.
4. Authenticated staging Agent Controller V2 run passes the exact İYS regression and paraphrase invariants.
5. Staging confirms `providerWebVisible=true` without a web keyword/regex route and the controller actually selects fresh web evidence for the current-web golden scenario.
6. Staging verifies the core receives the neutral Controller V2 plan rather than a legacy fallback plan.
7. Candidate-only search output is not accepted as verified evidence.
8. Grounding recovery/re-plan occurs before terminal fail-closed when budget remains.
9. Grounding safety regressions remain green.
10. Staging canary is verified before any production routing change.
