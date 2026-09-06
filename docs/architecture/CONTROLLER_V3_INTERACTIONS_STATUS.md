# Controller V3 / Gemini Interactions — Implementation Status

## Status

**Implementation complete for the current PR slice; production rollout remains a separate explicit action.**

Target architecture: ADR-10 — Retrieval Strategy and Tool Orchestration Belong to the Controller LLM.

## Delivered

- Gemini 3.8 Flash is the semantic controller on the active Gemini path.
- Gemini uses the Interactions API rather than a JETWORK-owned semantic planner around `generateContent`.
- Google Search, URL Context and Code Execution are native model-visible tools.
- Registered JETWORK custom functions are visible in the same Interactions tool surface.
- Built-in + custom tool combination uses `tool_choice=validated`.
- Semantic Top-K capability filtering is removed from the model-visible controller surface.
- Mandatory-next-tool / candidate-verification runtime protocol is removed from active knowledge retrieval.
- Runtime-authored knowledge query expansion is removed; the controller-authored query is executed verbatim.
- Gemini Interactions text streams through `step.delta` and provider TTFT/total timing is measured.
- Custom function results continue with `previous_interaction_id` + `function_result` using the original function call ID/name.
- A successful, mechanically accepted Gemini final persists a `gemini-interaction-state-v1` marker in `assistant_conversations.state_items`.
- The next user turn resumes from that interaction ID and sends only input after the marker instead of replaying the compact transcript.
- Tools, system instruction and generation config are re-specified on every resumed interaction because they are interaction-scoped.
- If JETWORK fail-closed grounding replaces an unsupported provider final, the interaction ID is deliberately not persisted; unverified hidden model state is therefore not chained into the next turn.
- Current-turn runtime evidence/provenance is re-stated beside the minimal controller constitution, while legacy domain workflow prose is filtered out of the Gemini system instruction.
- Gemini native tool steps and actual JETWORK custom-tool execution emit public-safe `provider_step` lifecycle events without raw function arguments or model thoughts.
- The shared Agent Work SSE adapter converts each real provider operation into canonical `tool_start -> tool_complete` events with the same `event_id` and `sequence`.
- Generic Controller V2 “first action / extra capability” synthesis statuses are suppressed on the active agentic loop where real operation events exist.
- Core mechanical grounding remains authoritative after model generation.

## Public/private reasoning boundary

Agent Work may expose:

- context/runtime preparation,
- public progress commentary,
- tool family start/completion,
- source counts/types,
- artifact lifecycle,
- warning/final lifecycle.

Agent Work must not expose:

- model thought steps,
- chain-of-thought,
- thought signatures,
- raw custom-function JSON arguments,
- secrets,
- tenant-private telemetry.

## Persistence invariant

A provider interaction marker is continuity state, not evidence.

```text
validated Gemini final
  -> createGeminiProviderStateItem(interaction_id)
  -> complete_assistant_turn(state_items)
  -> next turn loads state_items
  -> previous_interaction_id
  -> only current input is sent
```

Fail-closed grounding changes the path:

```text
unsupported provider final
  -> JETWORK grounding replacement
  -> NO interaction marker persisted
  -> next turn falls back to JETWORK resolved/compact context
```

## Agent Work invariant

```text
Gemini server tool step / JETWORK custom executor
  -> provider_step (public-safe internal SSE)
  -> AgentWorkSseAdapter
  -> tool_start(event_id=N, sequence=S)
  -> tool_complete(event_id=N, sequence=S)
```

Tool arguments and model-private reasoning never enter the public event payload.

## Verification gates

Before merge/release the branch must pass:

1. TypeScript typecheck.
2. Full unit suite.
3. Reasoning Quality Golden Gate.
4. AI behavior regressions.
5. Production build.
6. `main` reconciliation with `behind_by=0`.
7. PR remains mergeable.

Production deployment is intentionally excluded from this PR status and requires separate explicit approval.
