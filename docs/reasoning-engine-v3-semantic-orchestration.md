# JetWork Reasoning Engine v3 — Semantic Orchestration

## Why v3 exists

Reasoning Engine v2 already had strong execution primitives: conversation persistence, corporate knowledge tools, evidence verification, web research, provider adapters, durable turn leases and artifact handling. Its weak point was the decision boundary in front of those primitives.

The v2 router classified the current message with deterministic language patterns before the selected model saw the conversation. The final model was conversation-aware, but orchestration was not. A natural correction such as a user rejecting the previous SAP hypothesis could therefore be downgraded to `simple_answer`, disabling the exact knowledge tools needed to continue the diagnosis.

V3 changes the decision model, not the evidence/tool foundation.

## Core invariant

**Every substantive conversational turn is interpreted semantically against conversation context before JetWork chooses its execution path.**

The semantic orchestrator receives:

- the current raw user surface;
- recent messages preceding that exact user message;
- previous Reasoning Engine execution metadata when available;
- workspace title;
- attachment names;
- the user-selected provider/model boundary.

It returns a bounded `ReasoningPlan` containing:

- intent and complexity;
- execution mode;
- knowledge requirement;
- web policy;
- verification requirement;
- evidence queries;
- bounded execution steps;
- semantic conversation state (`continuation`, topic, user move, prior intent, rejected hypotheses, retained context and open questions).

The existing execution core then performs the actual knowledge search, detail lookup, relationship traversal, verification and synthesis.

## Request flow

```text
User message
    |
    v
Frontend persistence
    |
    v
Assistant gateway
    |
    +--> exact context-free social fast path (greeting / thanks only)
    |
    v
Load message-time conversation context + prior execution metadata
    |
    v
Claim semantic-plan lease / cache key
    |
    v
Selected-provider semantic orchestrator
    |
    v
Semantic ReasoningPlan + ConversationState
    |
    v
Provider-policy enforcement
    |
    v
Existing Reasoning execution core
    |
    +--> corporate knowledge tools
    +--> evidence verification
    +--> permitted web research
    +--> artifact/runtime path
    |
    v
Selected answer model
    |
    v
Durable response + reasoning ledger
```

## What is no longer allowed

Natural-language routing must not depend on a growing list of expressions such as `?`, `peki`, `neden`, `ona bak`, technical nouns or Turkish suffix matching. Those mechanisms cannot model dialogue continuity and are not a valid primary router.

Deterministic checks are allowed only for hard protocol/safety/optimization boundaries, for example:

- authentication and payload limits;
- allowed model IDs;
- attachment limits;
- exact context-free greeting/thanks fast path;
- explicit slash/protocol commands;
- provider isolation and security policy.

Even a short acknowledgement such as `tamam`, `ok` or `okay` is **not** context-free: it can approve a proposal, answer a clarification or continue an artifact task, so the gateway sends it to semantic orchestration.

## Conversation continuity

The orchestrator is responsible for deciding whether the current message is a new topic or a continuation. It must resolve natural corrections, rejections, pronouns, ellipsis and implicit references from recent dialogue and previous execution metadata.

For enterprise/technical tasks, a correction or rejected hypothesis must not silently downgrade the turn to direct chat. The plan remains evidence-driven and re-runs corporate knowledge where appropriate. Previous assistant prose is context, never evidence.

Example state shape:

```json
{
  "intent": "sap_diagnosis",
  "executionMode": "knowledge",
  "knowledgeRequired": true,
  "verificationRequired": true,
  "conversationState": {
    "continuation": true,
    "topic": "Cost ekleme sırasında alınan uyumsuzluk hatası",
    "userMove": "rejection",
    "priorIntent": "sap_diagnosis",
    "rejectedHypotheses": ["ZCRM_COST-112 / vade uyumsuzluğu"],
    "retainedContext": ["Kullanıcı hata metninde uyumsuz ifadesini hatırlıyor"],
    "openQuestions": ["Exact mesaj kodu bilinmiyor"]
  }
}
```

## Provider independence

Semantic orchestration follows the selected provider:

- explicit OpenAI -> OpenAI structured semantic plan;
- explicit Gemini -> Gemini structured semantic plan;
- Auto -> OpenAI first when configured, with Gemini semantic fallback permitted only in Auto mode.

An explicit provider must never silently invoke the other provider.

The semantic plan is internal control metadata. It is stripped from provider conversation items before final-answer synthesis and must never be shown as user-visible prompt text.

### Current web limitation

The existing execution core's live web researcher is OpenAI-backed. Therefore explicit Gemini turns cannot currently execute required live web research without violating provider isolation. V3 fails closed for that case instead of secretly using OpenAI. Provider-native Gemini web research is a separate adapter capability, not a reason to violate provider isolation.

## Semantic plan leases, rate limits and retries

Semantic interpretation itself is a paid model operation. It therefore happens behind an authenticated database claim:

`assistant_semantic_plans`

The semantic request hash includes the orchestrator version, selected model, current message, original message timestamp, bounded preceding conversation, prior execution metadata, workspace title and attachment names.

Consequences:

- repeated delivery of the same request reuses the completed semantic plan;
- concurrent duplicate calls do not execute the provider twice;
- stale/failed leases can be reclaimed;
- semantic provider calls are rate-limited before model execution;
- retrying an older message uses the context that existed **before that message**, not messages sent later in the conversation;
- changing relevant context/model/version produces a new deterministic semantic key.

A provider fallback plan is deliberately not cached as a completed semantic plan. This allows a later retry to recover a real semantic interpretation instead of permanently pinning the conservative fallback.

## Failure policy

If semantic interpretation fails, JetWork uses a conservative knowledge-first fallback rather than a broad direct-answer fallback. The fallback preserves a prior technical/analysis intent when previous execution metadata proves such a task was active.

The fallback never enables web research by itself.

## Existing v2 execution core

V3 intentionally reuses the battle-tested v2 execution implementation. `reasoningEngineLegacy.ts` and `modelProvidersLegacy.ts` preserve that behavior while thin v3 wrappers add semantic-plan consumption and strip internal metadata from provider inputs.

This means the current architecture is accurately described as:

**Reasoning Engine v3 semantic decision layer over the v2 durable execution core.**

The endpoint name `openai-assistant-core-v2` and its internal engine-version label remain legacy implementation details until the execution core is versioned separately. They must not be interpreted as evidence that semantic routing fell back to regex.

## Artifact adapter boundary

The frontend still contains explicit document/artifact lifecycle detection used to prepare the existing artifact UX. V3 strips generated document-routing text before semantic intent interpretation, so it cannot contaminate the semantic decision.

Long term, artifact lifecycle activation should consume server semantic metadata directly so the frontend no longer has any natural-language classification responsibility. Until then, this adapter is an explicit transitional boundary, not the primary execution router.

## Verification expectations

Regression coverage must include real dialogue, not only keyword fixtures. At minimum:

1. initial technical diagnosis uses corporate knowledge;
2. a natural-language rejection that repeats no SAP/CRM nouns remains the same diagnosis task;
3. rejected hypotheses are not repeated as facts without new evidence;
4. a second follow-up remains conversation-aware;
5. topic shifts can still leave the prior task cleanly;
6. `tamam/ok/okay` do not bypass conversation semantics;
7. explicit Gemini never causes an OpenAI web/tool call;
8. semantic plan cache preserves same-message retry idempotency;
9. provider-facing prompts do not contain `[JETWORK_SEMANTIC_PLAN]` metadata.
