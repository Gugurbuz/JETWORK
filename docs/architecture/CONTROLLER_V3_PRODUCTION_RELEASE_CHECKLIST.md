# Controller V3 — Production Release Checklist

## Release status

This checklist is the release gate for ADR-10 / Gemini 3.8 Flash Controller V3. Passing it means the branch is **production-ready**; it does not itself authorize merge or deployment.

## 1. Immutable release identity

Before rollout record:

- PR number and merge SHA,
- exact production Edge Function source SHA,
- frontend deployment SHA,
- active prompt/controller version,
- `CONTROLLER_CAPABILITY_SURFACE_VERSION`,
- Gemini model (`gemini-3.8-flash`),
- Gemini Interactions API transport version (`v1`).

Do not validate one SHA and deploy another.

## 2. CI gates — all mandatory

The exact release head must pass:

1. TypeScript typecheck.
2. Full Vitest unit suite.
3. Reasoning Quality Golden Gate.
4. AI behavior regressions.
5. Production frontend build.
6. `main...controller-v3-interactions` reports `behind_by=0` immediately before merge.
7. PR is open, non-draft and mergeable.

A skipped quality/build step caused by an earlier failure is not a pass.

## 3. Controller architecture gates

The active Gemini path must satisfy all of these:

- Gemini 3.8 Flash is the only semantic authority.
- Full registered JETWORK capability surface is model-visible.
- No semantic Top-K preselection hides tools before the first controller call.
- No mandatory-next-tool retrieval protocol is active.
- Knowledge queries are controller-authored, not expanded by runtime semantics.
- Google Search, URL Context and Code Execution are model-visible native tools.
- Custom JETWORK functions share the same Interactions tool surface.
- Tool combination uses validated tool choice.
- Runtime may reject invalid/unsafe actions but does not choose the semantic replacement action.

## 4. Gemini Interactions transport gates

Production transport:

- stable endpoint family: `v1/interactions`,
- REST SSE requested with `?alt=sse`,
- `Accept: text/event-stream`,
- `stream: true`,
- `store: true` for provider-owned continuation,
- custom-function continuation uses the original call ID/name plus `function_result`,
- cross-turn continuation uses validated `previous_interaction_id`,
- tools, `system_instruction` and generation configuration are re-specified on every resumed interaction,
- `interaction.failed`, `interaction.cancelled` and `interaction.incomplete` are terminal failures,
- transitional `interaction.status_update` may be accepted for compatibility but is not required by JETWORK logic.

## 5. Continuity and grounding gates

- A successful mechanically accepted Gemini final may persist a `gemini-interaction-state-v1` marker.
- A fail-closed grounding replacement must not persist that provider interaction ID.
- Provider state is continuity metadata, never enterprise evidence.
- Exact technical claims remain subject to the core grounding boundary.
- A candidate search result is not treated as citation-ready exact evidence.
- An artifact/action is complete only after its executor confirms success.

## 6. Agent Work gates

Public timeline may expose only:

- runtime/context preparation,
- controller-authored public progress,
- provider/custom-tool start and completion,
- source/artifact/warning/final lifecycle.

It must never expose:

- thought steps,
- chain-of-thought,
- thought signatures,
- raw function-call arguments,
- secrets or private telemetry.

For one real operation, `tool_start` and `tool_complete` must reuse the same `event_id` and `sequence`.

## 7. Rollout flags and rollback invariant

Two rollout switches exist during the migration window:

- canonical semantic-envelope flag: `AGENT_CONTROLLER_V2`,
- core compatibility flag: `ASSISTANT_AGENTIC_CONTROLLER`.

Until the legacy core switch is removed, production rollout automation/runbook must treat them as one atomic configuration:

### Enable Controller V3

```text
AGENT_CONTROLLER_V2=true
ASSISTANT_AGENTIC_CONTROLLER=true
```

### Immediate semantic rollback

```text
AGENT_CONTROLLER_V2=false
ASSISTANT_AGENTIC_CONTROLLER=false
```

Changing only one of the two is an invalid deployment configuration during this migration slice.

`ASSISTANT_REASONING_ENGINE_V2` remains the broader engine kill switch and is not the normal Controller V3 rollback mechanism.

## 8. Canary / smoke suite after deployment

Run the same exact release SHA through at least these scenarios before broad traffic:

1. **Direct answer** — no unnecessary tool call.
2. **Exact enterprise identifier** — e.g. a CRM/ABAP message; unsupported details fail closed.
3. **Follow-up referent** — ask for an object, then “ABAP kodunu ver”; previous interaction/context must resolve without replaying full history.
4. **Knowledge retrieval** — controller chooses search/exact/relation sequence itself.
5. **Web research** — native Google Search produces real URL sources.
6. **Mixed tools** — native web plus a JETWORK custom function in one task.
7. **Code execution** — provider server-tool lifecycle appears in Agent Work, private thought does not.
8. **Artifact** — executor creates output and completion is not claimed before executor success.
9. **Grounding block** — unsupported exact technical final is replaced and provider-state marker is discarded.
10. **Transport interruption** — idempotent recovery does not duplicate final text or reclaim a terminal server error.

## 9. Runtime metrics to watch

Compare against the validated baseline, at minimum:

- request-to-claim,
- claim-to-context,
- context-to-controller,
- controller decision latency,
- tool latency,
- replan latency,
- provider first-text latency,
- final generation TTFT,
- stream duration,
- total turn latency,
- controller rounds,
- tool calls,
- provider calls / successful turn,
- tokens / successful turn,
- cost / completed turn,
- cost / successful grounded answer,
- grounding fail-closed count/rate,
- provider-state continuation usage,
- failed/incomplete/cancelled Interactions count,
- completed-turn / visible-message mismatch count.

## 10. Stop / rollback conditions

Stop broad rollout and roll back Controller V3 if any of these appear above the agreed baseline/tolerance:

- completed turns without a visible assistant message,
- cross-tenant or authorization anomaly,
- unsupported enterprise facts escaping grounding,
- repeated interaction continuation failures,
- duplicated tool/action execution,
- Agent Work leaking private thought/tool arguments,
- artifact completion without a verified file,
- abnormal error/timeout rate,
- material quality regression,
- material token/cost regression without compensating quality gain.

Quality is the primary gate; provider-call or token reductions do not justify a lower grounded-answer success rate.

## 11. Rollback verification

After a rollback:

- confirm both Controller flags are false,
- verify one direct turn and one enterprise-grounded turn,
- verify no new `gemini-interaction-state-v1` markers are required by the rollback path,
- confirm visible-message persistence and SSE completion,
- compare error/latency counters to pre-rollout baseline.

## Release decision

A release is eligible only when every pre-deploy gate above is green on the exact merge candidate. Merge/deployment remain explicit operator decisions.
