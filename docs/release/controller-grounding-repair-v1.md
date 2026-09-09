# Controller Grounding Repair v1

This release adds one bounded grounding-repair opportunity to the same Controller LLM before the existing fail-closed response is persisted.

- Runtime validation reports coverage failures only.
- Runtime does not choose a recovery tool, query, domain route, or answer.
- The Controller retains the full model-visible capability surface and decides whether to call another capability or synthesize a safe answer.
- At most one repair attempt is allowed; existing fail-closed grounding remains the terminal safety boundary.
