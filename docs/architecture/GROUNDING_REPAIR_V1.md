# Grounding Repair v1

## Invariant

The Controller LLM remains the sole semantic authority. Runtime grounding validation may reject an unsupported draft, but it does not select a replacement tool, formulate a query, infer a domain route, or synthesize enterprise facts.

## Bounded repair lifecycle

1. Controller produces a candidate final answer.
2. The existing grounding guard evaluates the candidate against current-turn verified evidence.
3. If the candidate fails grounding, runtime returns a structured verification observation to the same Controller once.
4. The Controller may remove unsupported claims, synthesize from already verified evidence, or choose another visible capability/tool.
5. The next candidate is evaluated again. If it still fails, the existing fail-closed response is used.

A numeric SAP message lookup that has a verified message record for the requested number but produces a generic "message class/evidence missing" answer is treated as an evidence contradiction by the grounding guard. This is verification only; it does not decide which message class is correct or which tool to call.

## Non-goals

- No deterministic semantic router.
- No second planner or verifier LLM.
- No automatic domain-specific tool selection.
- No weakening of unsupported-identifier or exact-message-text guards.
