# Product Quality Hardening

This package protects two user-visible contracts around BA artifacts.

## Source fidelity

When the user explicitly defines a functional process using named `Süreç 1/2/3` steps, those source labels are treated as immutable business facts. The artifact normalizer restores missing labels under `4.2 Süreç Akışı`, rejects unsupported enterprise-system enrichment for that source-only contract, and turns unsupported numeric/date/SLA commitments into `[AÇIK KONU]`.

Technical requests without an explicit user-defined process contract keep normal Knowledge v2 enrichment behavior.

Multi-turn artifact tasks preserve the initial request and append later clarification answers so the original source does not disappear before Canvas persistence.

## Neutral maturation questions

Questions used to mature a future document remain limited to three and are rendered without model-proposed option buttons. Generic chat questions keep the existing option-button capability.

## E2E rollout note

The source-fidelity browser scenario must run against `normalize-artifact-v2` contract `enerjisa-ba-v2-source-fidelity`. Artifact Runtime records the contract version and fidelity metrics in `artifact_payload` so this can be verified independently of the UI.
