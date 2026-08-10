# Deterministic Enumeration Finalizer

When `list_knowledge_catalog` pagination has collected every catalog row (`collectedCount >= totalCount` and `nextCursor = null`), the reasoning core finalizes the answer directly from structured tool output before calling Gemini or OpenAI again.

This is a runtime invariant, not a prompt preference: a completed enumeration cannot be contradicted by a final synthesis model. If pagination is still incomplete and the tool-round budget is exhausted, a deterministic partial response is allowed only after multiple pages have been collected; single-page discovery/count flows stay on normal synthesis.

The finalizer records `deterministic_enumeration_*` usage markers and a structured `deterministicEnumeration` block in the reasoning ledger for production observability.
