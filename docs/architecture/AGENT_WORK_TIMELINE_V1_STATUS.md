# Agent Work Timeline v1 — Implementation Status

## Scope delivered

- Canonical public operational event model with stable event identity and sequence.
- Same-event lifecycle updates (`tool_start` -> `tool_complete`) without duplicate rows.
- Separate `AgentWorkHeader`, `AgentWorkTimeline`, `AgentActivityRow`, `ToolActivityRow`, and `SourceActivityRow` presentation components.
- Presentation-only mobile compaction; reducer and persisted chronology never delete completed events.
- Canonical SSE side-channel for `agent_activity`, `tool_start`, `tool_complete`, `artifact`, `warning`, and `final` while legacy stream events remain compatible.
- Direct client consumption at the SSE parser boundary, so canonical events are not reconstructed from status labels once available.
- Public operational chronology only. Private reasoning, chain-of-thought, function JSON, secrets, and provider-private telemetry are excluded.
- Durable reload persistence through a versioned `raw_response` envelope (`jetwork-agent-work:v1:`) without requiring a production schema migration.
- Existing plain `raw_response` values remain backward compatible and are restored unchanged.
- CHECK_ZTKS acceptance coverage across SSE adapter, reducer, timeline, and header behavior.
- Durable chronology tests cover duplicate labels with distinct event IDs and histories longer than 128 events without truncation.

## Persistence invariant

`thinkingText` is now a compatibility summary/fallback. Canonical `workEvents` are the authoritative public chronology whenever present. Reload hydration restores these events by the assistant message `createdAt` timestamp.

## Database rollout

No schema mutation is required for v1. `public.messages.raw_response` is an existing nullable `text` column and the Agent Work envelope is stored there only for Single Assistant Runtime model messages. A dedicated `work_events jsonb` column may be introduced later through a coordinated migration, but it is not required for this rollout.

## Release gate

Before merging:

1. Reconcile with latest `main`.
2. Require full GitHub CI green on the reconciled head.
3. Confirm no Agent Work/private-reasoning boundary regression.
4. Treat Vercel Hobby build-rate-limit failures separately from code/build failures.
5. Keep production deployment explicit; this branch must not deploy production merely because the PR is green.
