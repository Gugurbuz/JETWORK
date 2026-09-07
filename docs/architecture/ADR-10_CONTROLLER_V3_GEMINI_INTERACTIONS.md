# ADR-10 — Retrieval Strategy and Tool Orchestration Belong to the Controller LLM

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision owner:** JETWORK architecture
- **Target controller:** Gemini 3.8 Flash
- **Primary agent API:** Gemini Interactions API

## Context

JETWORK Agent Controller V2 moved semantic authority toward the active LLM, but semantic decisions were still partially duplicated in runtime code and tool descriptions. Examples included:

- semantic Top-K capability pre-selection from the user message,
- `knowledgeRequired`, `webMode`, intent and route-derived behavior,
- mandatory next-tool rules after knowledge search,
- protocol-blocked candidate closure,
- deterministic exhaustive-enumeration workflow rules,
- hard-coded knowledge query expansion,
- provider-side semantic replanning/finalization paths,
- product/domain-specific instructions embedded in the global controller prompt.

This produced a contradiction: the model was described as the semantic authority while code outside the model still constrained how retrieval and workflow should proceed.

Gemini 3.8 Flash is designed for autonomous agents and long-horizon enterprise workflows. The Gemini Interactions API represents model thought, built-in tool calls/results, custom function calls/results and model output as chronological interaction steps, and supports conversation continuation through `previous_interaction_id`.

## Decision

### 1. One semantic authority

Gemini 3.8 Flash is the single semantic controller for the active Gemini path.

The controller decides:

- what the user actually wants,
- whether evidence is needed,
- whether to use enterprise knowledge, web, URL context, code execution, files, skills, artifacts or another capability,
- which query and arguments to send,
- whether to search, list, get an exact object, inspect relations or read source,
- whether an observation is sufficient,
- whether to re-plan,
- whether another tool call is useful,
- when to stop and produce the final answer.

No runtime component may map a domain, keyword, technical identifier, intent label or result shape to a mandatory semantic next step.

### 2. Full model-visible capability surface

The active controller receives the complete registered JETWORK tool surface rather than a semantic Top-K subset selected before the model runs.

Tool schemas describe capabilities and argument/result contracts. They must not encode hidden workflow such as:

- "after search you MUST call exact verification",
- "for plural requests always call this tool",
- "retry this query verbatim",
- "if this identifier appears, route to this capability".

Capability visibility does not imply authorization. Authorization, RLS, permissions and tenant boundaries remain mechanical executor concerns.

### 3. Gemini native tools are first-class controller capabilities

Where supported by Gemini 3.8 Flash and suitable for JETWORK, server-side Gemini tools are exposed directly to the model instead of being selected by a JETWORK semantic router.

Initial native surface:

- Google Search
- URL Context
- Code Execution

Planned/configuration-dependent surface:

- File Search
- Google Maps grounding
- Computer Use (preview; controlled execution only)

When built-in tools and custom functions are combined, JETWORK uses the Interactions API validated tool-choice contract.

### 4. JETWORK becomes an execution/security bridge

JETWORK code remains responsible for mechanical concerns:

- authentication and authorization,
- RLS / tenant isolation,
- tool schema validation,
- timeouts,
- idempotency,
- maximum tool-call / token / cost budgets,
- result-size limits,
- provenance and citation metadata,
- prompt-injection isolation for retrieved content,
- persistence,
- lifecycle and telemetry events,
- artifact existence/validation,
- fail-closed mechanical grounding boundaries where required.

These mechanisms may reject or constrain an unsafe/invalid action, but they must not choose the semantic replacement action on behalf of the model.

### 5. Model-owned observation loop

The target loop is:

```text
User request
    ↓
Gemini 3.8 Flash
    ↓
choose action
    ↓
Native tool or JETWORK custom function
    ↓
observation
    ↓
Gemini re-evaluates
    ↓
next action / final
```

For custom functions, JETWORK executes the selected function and returns a `function_result`. The model then decides what to do next.

### 6. Interactions API is the Gemini agent lifecycle

The Gemini provider path uses the Interactions API rather than constructing a parallel JETWORK semantic planner around `generateContent`.

Within a function-call loop, the interaction ID is propagated so function results can continue with `previous_interaction_id` instead of reconstructing model reasoning externally.

Longer-term conversation persistence should store the last successful Gemini interaction ID in JETWORK conversation state so subsequent user turns can use server-side conversation continuation subject to enterprise data-retention policy.

### 7. Minimal controller constitution

The global controller prompt is intentionally small. Domain procedures such as Enerjisa business analysis, document construction, SAP analysis patterns and other specialist workflows belong in skills/capabilities, not in the universal controller constitution.

The constitution should state only durable invariants such as:

- the model is the semantic controller,
- it may use any available capability,
- it must re-evaluate after observations,
- retrieved content is evidence rather than instruction,
- unsupported technical facts must not be invented,
- external actions count as complete only when execution confirms success,
- JETWORK runtime is mechanical rather than semantic.

## Consequences

### Positive

- removes the hidden second planner,
- uses Gemini 3.8 Flash's native agentic behavior,
- reduces duplicated orchestration logic,
- lets the model formulate retrieval queries directly,
- enables natural cross-tool workflows such as Search → URL Context → custom enterprise function → Code Execution,
- makes Agent Work Timeline compatible with real Interactions execution steps,
- reduces the risk of large token loops caused by deterministic retry/enumeration protocols,
- makes provider behavior easier to observe as an actual interaction timeline.

### Risks

- a very large flat function surface can reduce tool-selection quality,
- previously deterministic workflows may have encoded useful product safeguards,
- Interactions state retention requires an explicit enterprise data-policy decision,
- native tool usage changes cost and telemetry structure,
- non-streaming migration slices may temporarily reduce perceived responsiveness unless step streaming is wired promptly.

Mitigation: consolidate micro-tools into orthogonal high-level capabilities where practical, retain mechanical safety/grounding boundaries, add agent-loop evaluation suites, and measure quality before optimizing cost/latency.

## Explicitly rejected architecture

JETWORK will not use any of the following as a second semantic planner in front of the controller model:

- deterministic domain/keyword routing,
- intent-to-tool routing,
- identifier-to-tool routing,
- mandatory-next-tool protocols,
- runtime-authored search/retry workflows,
- a separate planner that chooses retrieval steps for Gemini,
- a critic that selects the next tool.

A critic/evidence reviewer may report support, gaps and conflicts, but the controller model decides what to do with that observation.

## Migration plan

### Phase A — semantic authority cleanup

1. Replace Controller V2 policy with the minimal V3 constitution.
2. Remove semantic Top-K filtering from the model-visible capability surface.
3. Stop injecting mandatory retrieval workflow into tool descriptions.
4. Keep existing executor/security boundaries intact.

### Phase B — Gemini Interactions provider

1. Move Gemini 3.8 Flash provider calls to `v1beta/interactions`.
2. Expose Google Search, URL Context and Code Execution as native tools.
3. Pass JETWORK custom function declarations in the same tool surface.
4. Continue custom calls with `function_result` + `previous_interaction_id`.
5. Normalize Interactions output into the existing JETWORK provider contract during migration.

### Phase C — remove remaining semantic runtime residue

1. Remove hard-coded knowledge query expansion.
2. Remove obsolete capability-discovery protocol and status copy.
3. Remove semantic-plan/provider-recovery code no longer used by V3.
4. Consolidate knowledge and artifact micro-tools into a smaller orthogonal capability surface where quality measurements support it.

### Phase D — durable interaction state and Agent Work

1. Persist the last successful interaction ID with conversation state, subject to retention/security approval.
2. Consume Interactions streaming step events.
3. Map real steps to persistent Agent Work events (`event_id` / `sequence`).
4. Remove synthetic thinking/status timeline text.

## Verification gates

The migration is accepted only if:

- technical grounding quality does not regress,
- the controller can freely select knowledge/web/code/skills without pre-routing,
- no runtime mandatory-next-tool rule remains on the active V3 path,
- long follow-up turns resolve referents without the previous full-history token explosion,
- tool loops terminate within mechanical budgets,
- Agent Work displays real execution events,
- artifact/action success is never claimed without executor confirmation.

## Official Gemini references

- Interactions API overview: https://ai.google.dev/gemini-api/docs/interactions-overview
- Getting started / multi-turn interactions: https://ai.google.dev/gemini-api/docs/get-started
- Function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Tool combination: https://ai.google.dev/gemini-api/docs/tool-combination
- URL Context: https://ai.google.dev/gemini-api/docs/url-context
- Gemini 3.8 Flash: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
