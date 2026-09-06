# Agent Work Timeline v1 — Implementation Status

## Status

**Implementation complete / review-ready. Production rollout is a separate explicit action.**

Final product verification baseline: `3a2d57b8a5e0b5eeadc3415b0632acce336eb871`.

- `Agent Work Browser Acceptance`: PASS.
- Full GitHub CI: PASS.
- Latest `main` reconciled: `behind_by = 0`.
- Production merge/deployment: NOT performed.

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
- A successful runtime turn remains active until canonical Agent Work chronology has crossed the durable message-save boundary; completion cannot race ahead of persistence.
- Realtime provider redaction cannot leave a durably saved turn stuck in the active state.
- Hydrated `message.workEvents` are passed directly from `ChatPanel` to `AssistantWorkIndicator`, making the persisted message envelope the reload presentation authority rather than an in-memory fallback registry.
- Authenticated Playwright acceptance verifies the CHECK_ZTKS UI path, unique canonical event IDs, source event visibility, final collapse, and identical chronology after page reload.
- `.github/workflows/agent-work-browser-acceptance.yml` runs the feature frontend locally on the GitHub runner with real JETWORK Supabase authentication/database persistence while intercepting the assistant SSE with a deterministic canonical CHECK_ZTKS stream. This keeps browser persistence/reload verification independent from Vercel Deployment Protection and external model latency.
- The browser gate watches Agent Work UI, reducer, persistence, transport-recovery, message-store, SSE adapter, and `ChatPanel` wiring changes.

## Persistence invariant

`thinkingText` is a compatibility summary/fallback. Canonical `workEvents` are the authoritative public chronology whenever present.

For persisted messages, the authoritative reload path is:

`messages.raw_response` Agent Work envelope -> message hydration -> `message.workEvents` -> `ChatPanel` -> `AssistantWorkIndicator` -> `AgentWorkTimeline`.

Fallback/reconstructed `reported:*` or `observed:*` events are allowed only when canonical events are genuinely absent. They must never merge into or override a canonical snapshot.

## Database rollout

No schema mutation is required for v1. `public.messages.raw_response` is an existing nullable `text` column and the Agent Work envelope is stored there only for Single Assistant Runtime model messages. Read-only production verification confirmed recent CHECK_ZTKS E2E rows contained the canonical `jetwork-agent-work:v1:` envelope with `agent:1` through `final:6` events. A dedicated `work_events jsonb` column may be introduced later through a coordinated migration, but it is not required for this rollout.

## Release gate — satisfied for review

1. Latest `main` reconciled: PASS (`behind_by = 0`).
2. Full GitHub CI on the reconciled product head: PASS — typecheck, unit tests, reasoning quality gate, AI behavior regressions, and production build.
3. Public/private reasoning boundary regression checks: PASS through unit/quality gates.
4. `Agent Work Browser Acceptance`: PASS, including CHECK_ZTKS reload chronology equality.
5. Canonical persistence verified in the database and direct hydrated-message rendering verified in the product UI path.
6. Production deployment remains explicit and separate; a green PR must not deploy production by itself.

## Review disposition

PR #213 can be marked ready for review. Merge and production deployment remain separate release actions and require their own explicit decision.
