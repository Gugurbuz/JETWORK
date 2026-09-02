# Agentic Runtime P0/P1 Inventory

Status: in progress  
Branch: `feat/agentic-controller-runtime` / PR #203  
Architecture invariant: `LLM decides -> Runtime executes/guards -> Observation returns -> LLM re-plans`

## P0 baseline status

- [x] Branch aligned with current `main` through a merge commit.
- [x] Qwen/local runtime changes kept outside Agentic semantic decisions.
- [x] PR CI no longer edits source files or commits fixes back to the branch.
- [x] One-time `fix-*` / `patch-*` workflows and trigger files removed.
- [x] Canonical rollout flag introduced as `AGENT_CONTROLLER_V2`; missing/invalid configuration is OFF.
- [x] Initial module boundaries established under `_shared/agent`, `_shared/context`, `_shared/runtime` with temporary compatibility exports.
- [ ] Complete module extraction for controller loop/state, capability registry/discovery, evidence and artifact runtime.
- [ ] Persist branch SHA/runtime version/controller mode/provider on every turn telemetry record.

## P1 semantic decision inventory

### Must be removed/bypassed when `AGENT_CONTROLLER_V2=ON`

1. `trivialAssistantFastPath.ts`
   - Classifies user text with regex/token rules before the controller.
   - Can generate a response without the controller loop.
   - P1 action: make it legacy-only, then remove after rollout.

2. `authoritativeInventoryFastPath.ts`
   - Previously mapped broad class-inventory wording directly to `list_class_inventory`.
   - Current state: **blocked when Agent Controller V2 is active**; retained only for legacy runtime migration.

3. `documentArtifactRouting.ts`
   - Uses create/revise/file/analysis keyword regexes to decide artifact routing.
   - P1 action: controller chooses artifact capability; runtime validates artifact contract/executor only.

4. `openai-assistant-v2/index.ts` gateway semantic orchestration
   - Gateway currently loads semantic context and can build semantic execution plans before dispatch.
   - P1 action: gateway remains auth/rate-limit/idempotency/lease/SSE only; context resolution and semantic choice move behind the controller boundary.

5. `semanticOrchestrator.ts` / reasoning plan fields
   - Existing intent, complexity, `knowledgeRequired`, `webMode` and execution mode may remain temporarily as advisory telemetry/context.
   - P1 invariant: none of these fields may forbid/force a capability when Agent Controller V2 is active.

### Mechanical/grounding behavior that may remain

- Tool authorization and workspace access.
- Schema validation.
- Timeout and global round/tool-call budgets.
- Turn lease/idempotency/persistence.
- Exact-identifier detection only when used as a grounding/stream-safety guard; it must not pick a knowledge tool or route.
- Artifact schema validation, executor requirement and reload/integrity verification.

### Legacy-only paths during rollout

- Deterministic enumeration finalization is acceptable only while `AGENT_CONTROLLER_V2=OFF` and must not execute in the new controller path.
- Existing semantic fast paths may remain temporarily only when explicitly guarded as legacy runtime behavior.

## Next implementation slice

1. Make `trivialAssistantFastPath` legacy-only under the canonical feature flag.
2. Remove artifact keyword routing from the Agent Controller V2 path.
3. Move controller policy/state/loop into `_shared/agent/` and make the gateway semantically inert.
4. Add structural regression tests proving that Agent Controller V2 cannot be bypassed by keyword, exact identifier, enumeration or artifact wording.
5. Extend telemetry with runtime version, controller round, available/selected capability, termination reason and budget before/after.
