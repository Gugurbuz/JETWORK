# Agentic Semantic Authority Leak Fix

## Incident

Production turn `5eafa5ec-054b-4fb7-bc4b-6ef90bddc51e` showed Agent Controller V2 telemetry while the deployed assistant topology still allowed legacy semantic authority to leak back into the turn.

Three independent defects were confirmed:

1. Production `openai-assistant-v2` was an ad-hoc Gemini 3.8 proxy that forwarded the raw user message directly to `assistant-primary-agent-core-canary`, bypassing the repository semantic gateway and its neutral Controller V2 advisory envelope.
2. The alternate deployed `openai-assistant-v2-internal` path imported `openai-assistant-v2/index.ts` from legacy Git commit `3dde3a3b0aac74ff7b36657e6931ffdb7a2dedc5`.
3. Semantic Top-K could omit `provider:web_search` and foundational knowledge evidence tools, so the active LLM controller could lose a valid capability before it had the opportunity to choose it.

The same validation work exposed a deployment-topology defect: JETWORK must not depend on anonymous `raw.githubusercontent.com` imports for private-repository Edge runtime code. Runtime deployment therefore has to materialize repository source into the Edge deployment package/bundle instead of treating a private GitHub raw URL as a durable module host.

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
10. Production rollout is blocked until deterministic CI, deployment-source/topology verification, golden scenarios, smoke and canary gates pass.

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

## Deployment packaging validation

The repository validation workflow materializes three private-repository runtime bundles:

- public entry/router bundle
- internal semantic-gateway bundle
- core runtime bundle

The bundle gate rejects `raw.githubusercontent.com/Gugurbuz/JETWORK` references in generated runtime artifacts. This validates that the desired Edge deployment payload is self-contained with respect to private JETWORK source.

This check is environment-neutral and runs independently from provider credentials. Real provider behavior is validated through the normal golden contracts plus production smoke/internal canary flow rather than a separate permanent environment.

## Verification model

Pre-merge:

1. Typecheck, build, unit and golden tests.
2. Materialized Edge bundle validation.
3. Vercel Preview UI/E2E where UI changes are involved.
4. No production write or rollout side effect.

Post-merge / release:

1. Deploy production Edge functions and Vercel production from the approved SHA.
2. Run bounded smoke tests with the designated test user/workspace.
3. Run internal canary scenarios, including semantic-authority/current-web and grounding regressions.
4. Observe controller route, model isolation, evidence/source behavior, TTFT/latency and failure taxonomy.
5. Expand rollout only while quality and performance floors remain green.
6. Roll back with the canonical feature flag/config if a release gate fails.

## Current verification status

At the latest hardening baseline:

- deterministic CI is green on the semantic-authority implementation;
- materialized runtime bundle generation rejects private GitHub raw imports;
- the exact İYS scenario is present in the P6 golden contract;
- generic Agentic Runtime golden scorer, trace adapter, performance adapter and debug reader remain canonical;
- dedicated environment-specific probe/suite/executor code is not part of the release architecture;
- production validation is performed through bounded smoke + internal canary rather than a parallel environment.

## Rollout gate

Do not expand production routing until:

1. CI typecheck/build/unit/golden tests are green on the final head SHA.
2. Materialized Edge deployment artifacts contain no private JETWORK raw runtime import.
3. Preview validation is green for changed UI/client surfaces.
4. Production deploy uses the approved SHA and canonical Controller V2 topology.
5. Production smoke passes authentication, streaming, persistence and basic controller-route checks.
6. Internal canary passes the exact İYS regression and freshness paraphrase invariants.
7. Canary confirms `providerWebVisible=true` without a web keyword/regex route and the controller selects fresh web evidence when needed.
8. Candidate-only search output is not accepted as verified evidence.
9. Grounding recovery/re-plan occurs before terminal fail-closed when budget remains.
10. Quality, latency and failure telemetry remain within the accepted release floors before broader rollout.
