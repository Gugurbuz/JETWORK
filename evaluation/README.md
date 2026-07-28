# Golden evaluation

The contract contains 30 scenarios: 15 behavior references from AIAnalyst and
15 Jetwork regression scenarios. Every live result is scored on the eight
rescue-plan criteria.

Run the contract checks:

```sh
pnpm run verify:golden-contract
```

Run the real Jetwork orchestrator against all scenarios:

```sh
VITE_SUPABASE_URL=... \
VITE_SUPABASE_ANON_KEY=... \
GOLDEN_MODEL=gemini-3-flash-preview \
GOLDEN_MIN_SCORE=95 \
pnpm run evaluate:golden -- --output evaluation/results/jetwork-live-final.json
```

The runner signs in anonymously by default. For a configured test identity, set
both `GOLDEN_ACCESS_TOKEN` and `GOLDEN_REFRESH_TOKEN`.

`GOLDEN_SCENARIO_LIMIT` may be used for development smoke runs.
`GOLDEN_SCENARIO_IDS` accepts a comma-separated list of scenario IDs for
targeted regression checks. Release evaluation must run all 30.
