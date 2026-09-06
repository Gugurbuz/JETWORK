# Agent Work Timeline v1 — Implementation Status

## Scope delivered

- Canonical public operational event model with stable event identity and sequence.
- Same-event lifecycle updates (`tool_start` -> `tool_complete`) without duplicate rows.
- Separate `AgentWorkHeader`, `AgentWorkTimeline`, `AgentActivityRow`, `ToolActivityRow`, and `SourceActivityRow` presentation components.
- Presentation-only mobile compaction; reducer and persisted chronology never delete completed events.
- Canonical SSE side-channel for `agent_activity`, `tool_start`, `tool_complete`, `artifact`, `warning`, and `final` while legacy stream events remain compatible.
- Direct client consumption at the SSE parser boundary, so canonical events are not reconstructed from status labels once available.
- First `text_delta` does not terminate or hide the active Agent Work event; completed chronology remains visible while answer text starts streaming.
- Public operational chronology only. Private reasoning, chain-of-thought, function JSON, secrets, and provider-private telemetry are excluded.
- Knowledge, web, and user-media source classes remain distinct in public source events; user media can never be counted as a corporate knowledge source.
- Durable reload persistence through a versioned `raw_response` envelope (`jetwork-agent-work:v1:`) without requiring a production schema migration.
- Existing plain `raw_response` values remain backward compatible and are restored unchanged.
- CHECK_ZTKS acceptance coverage across SSE adapter, reducer, timeline, header behavior, first-delta concurrency, and reload persistence.
- Durable chronology tests cover duplicate labels with distinct event IDs and histories longer than 128 events without truncation.
- Authenticated Playwright acceptance now verifies a real CHECK_ZTKS turn, live timeline visibility, unique event IDs, source evidence, final collapse, and identical chronology after page reload.
- `.github/workflows/agent-work-browser-acceptance.yml` provides an explicit preview-URL browser release gate using repository E2E credentials and fails when credentials are unavailable instead of silently skipping.

## Persistence invariant

`thinkingText` is now a compatibility summary/fallback. Canonical `workEvents` are the authoritative public chronology whenever present. Reload hydration restores these events by the assistant message `createdAt` timestamp.

## Database rollout

No schema mutation is required for v1. `public.messages.raw_response` is an existing nullable `text` column and the Agent Work envelope is stored there only for Single Assistant Runtime model messages. A dedicated `work_events jsonb` column may be introduced later through a coordinated migration, but it is not required for this rollout.

## Release gate

Before merging:

1. Reconcile with latest `main` and require `behind_by = 0`.
2. Require full GitHub CI green on the reconciled head: typecheck, unit tests, reasoning quality gate, AI behavior regressions, and production build.
3. Confirm no Agent Work/private-reasoning boundary regression.
4. Run `Agent Work Browser Acceptance` against the intended branch preview and require the CHECK_ZTKS Playwright scenario to pass, including reload chronology equality.
5. Treat Vercel Hobby build-rate-limit failures separately from code/build failures; do not interpret a rate-limit status as a source/build regression.
6. Keep production deployment explicit; this branch must not deploy production merely because the PR is green.
