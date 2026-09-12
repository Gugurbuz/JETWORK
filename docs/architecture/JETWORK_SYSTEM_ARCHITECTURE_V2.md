# JETWORK System Architecture V2

Status: **Approved architecture baseline**  
Architecture branch: `architecture/system-architecture-v2`  
Baseline: `main@498100e3333d5c13522fbf4c5d02cb1b9e643e8f`  
Supersedes as system-level reference: runtime-only diagrams and ad-hoc version-wrapper topology.  
Does **not** automatically obsolete the Agentic Runtime Technical Master Plan; it places that plan inside a larger platform architecture.

---

## 1. Purpose

JETWORK is not a single agent loop. It is an enterprise AI platform whose conversational runtime is one bounded context inside a larger product, data, control and operations system.

System Architecture V2 defines:

- the platform planes and bounded contexts;
- ownership and dependency boundaries;
- canonical runtime and data contracts;
- synchronous vs asynchronous execution boundaries;
- evidence, memory and artifact lifecycles;
- model/provider isolation;
- security, governance, observability and evaluation control planes;
- logical data ownership;
- deployment topology and rollout gates;
- architecture fitness functions enforced in CI;
- migration rules for existing JETWORK code, including the current AgenticRuntime wrapper stack.

This document is the **system-level architectural contract**. Feature implementation must conform to it or introduce an explicit ADR that explains why an exception is required.

---

## 2. Relationship to the Agentic Runtime Technical Master Plan

The Technical Master Plan remains valid for the runtime transformation and contributes the following non-negotiable invariants:

1. **One semantic decision authority:** the active controller LLM decides what semantic action is required.
2. **Runtime is mechanical:** authorization, schema validation, timeout, budget, persistence, telemetry, lease/idempotency and safety are runtime responsibilities.
3. **No domain/keyword/identifier semantic routing in runtime.**
4. **Memory is not raw chat history:** recent conversation, resolved conversation state and project memory are separate.
5. **Evidence is structural:** claims, sources, coverage, gaps and conflicts must be representable independently of final prose.
6. **Critic is not a second planner:** it reports evidence quality/coverage; it does not choose the next capability.
7. **Artifacts are not complete until execution + reload/integrity verification succeed.**
8. **Quality precedes performance/cost optimization.**
9. **Explicit provider choice is isolated; no silent provider fallback.**
10. **Production rollout is gated by unit/contract/golden/live E2E, canary, observability and rollback.**

System Architecture V2 adds the missing system-wide structure around those invariants.

---

## 3. Architecture Style

JETWORK V2 is a **modular platform with strict bounded contexts and event-capable execution**.

It is intentionally **not** a microservice-first rewrite.

Initial physical deployment may continue to use Vercel + Supabase Edge + Postgres/Storage, but logical domain boundaries must be enforced in code and contracts before any physical service split.

### 3.1 Architectural rule

> **Logical boundaries first. Physical distribution only when justified by scaling, reliability, security or deployment independence.**

A module is not allowed to bypass another bounded context by importing its private implementation simply because both currently run in the same Edge Function.

### 3.2 Primary dependency direction

```text
Experience
   |
   v
Access / Gateway
   |
   v
Platform Kernel
   |
   +-------------------+-------------------+
   |                   |                   |
   v                   v                   v
Context            Capability          Agent
Platform           Platform            Orchestration
   |                   |                   |
   +-----------+-------+---------+---------+
               |                 |
               v                 v
       Knowledge/Evidence    Execution/Artifact
               |                 |
               +--------+--------+
                        |
                        v
                    Data Plane
```

Cross-cutting control planes observe and constrain this flow but do not become semantic routers.

---

## 4. System Context

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│                               JETWORK USERS                                   │
│ Analyst │ Product Owner │ Developer │ Manager │ Administrator │ Automation    │
└─────────────────────────────────────┬─────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           EXPERIENCE / PRODUCT PLANE                          │
│ Chat │ Projects │ Knowledge Base │ Files │ Artifacts │ Quality │ Admin       │
│ Sources │ Workspace │ Agent Status │ Approval UI │ Search │ History          │
└─────────────────────────────────────┬─────────────────────────────────────────┘
                                      │
                                      ▼
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         ACCESS / EDGE / GATEWAY PLANE                         ║
║ Auth │ JWT │ RLS │ Workspace/Tenant │ Idempotency │ Turn Lease │ SSE         ║
║ Rate Limit │ Request Admission │ API Version │ Upload Admission              ║
║                         SEMANTICALLY INERT                                    ║
╚═════════════════════════════════════╤═════════════════════════════════════════╝
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              PLATFORM KERNEL                                 │
│ Turn Manager │ Task/Run Manager │ Budget │ Deadlines │ Runtime Config        │
│ Feature Flags │ Trace Context │ Transaction/Outbox Coordination             │
└─────────────┬───────────────────┬───────────────────┬─────────────────────────┘
              │                   │                   │
              ▼                   ▼                   ▼
┌──────────────────────┐ ┌────────────────────┐ ┌─────────────────────────────┐
│ CONTEXT PLATFORM     │ │ CAPABILITY PLATFORM│ │ AGENT ORCHESTRATION        │
│ recent conversation  │ │ registry           │ │ controller                 │
│ resolved state       │ │ semantic discovery │ │ re-plan loop               │
│ project memory       │ │ contracts          │ │ termination                │
│ active artifact      │ │ skill manifests    │ │ dependency/task graph      │
│ attachments          │ │ connector catalog  │ │ decision records           │
└──────────┬───────────┘ └──────────┬─────────┘ └─────────────┬───────────────┘
           │                        │                         │
           └──────────────┬─────────┴─────────────┬───────────┘
                          │                       │
                          ▼                       ▼
┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
│ KNOWLEDGE & EVIDENCE FABRIC      │   │ INTELLIGENCE / MODEL PLATFORM       │
│ source registry                  │   │ model gateway                        │
│ ingestion                        │   │ provider adapters                    │
│ exact / semantic / graph search  │   │ provider isolation                  │
│ evidence ledger                  │   │ structured generation               │
│ coverage / gaps / conflicts      │   │ token/cost accounting               │
│ immutable evidence snapshots     │   │ prompt/policy registry              │
└────────────────┬─────────────────┘   └──────────────────┬───────────────────┘
                 │                                        │
                 └──────────────────┬─────────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                            EXECUTION PLATFORM                                 │
│ Tool Executor │ Connector Executor │ Workflow Jobs │ Timeout │ Retry         │
│ Idempotency │ Compensation │ Sandbox │ Async Worker │ Result Normalization   │
└─────────────────────────────────────┬─────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                             ARTIFACT PLATFORM                                 │
│ Artifact Contracts │ Canonical Artifact Model │ Revision Engine              │
│ DOCX │ XLSX │ PPTX │ PDF │ Validation │ Reload │ Integrity │ Persistence    │
└─────────────────────────────────────┬─────────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                                 DATA PLANE                                    │
│ Operational DB │ Object Storage │ Vector Index │ Graph Relations │ Cache     │
│ Event/Outbox │ Audit │ Telemetry │ Evaluation │ Usage/Cost                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Cross-Cutting Control Planes

These planes span the platform vertically. They are not agent tools and are not owned by the controller.

### 5.1 Security & Trust Plane

Owns:

- authentication and identity;
- tenant/workspace isolation;
- RLS/ACL;
- capability authorization;
- connector credentials and secret access;
- data classification;
- prompt/tool injection protection;
- PII handling;
- artifact access policy;
- audit trail;
- high-risk action approval.

Must not own:

- semantic capability selection;
- final answer generation;
- business-domain routing.

### 5.2 Governance Plane

Owns versioned policy:

- model policy;
- capability enablement;
- evidence requirements;
- memory persistence policy;
- artifact policy;
- human approval policy;
- cost/budget ceilings;
- retention;
- rollout configuration.

Governance returns **constraints**, not semantic plans.

### 5.3 Observability Plane

Every turn must be traceable through:

- request admission;
- context resolution;
- capability discovery;
- controller round;
- provider call;
- capability execution;
- evidence production;
- artifact lifecycle;
- persistence;
- streaming completion.

No private chain-of-thought is persisted. Only structured decision/output metadata is logged.

### 5.4 Evaluation Plane

Owns:

- unit/deterministic tests;
- contract tests;
- state-machine tests;
- golden task tests;
- retrieval tests;
- grounding tests;
- artifact integrity tests;
- adversarial tests;
- live-like E2E;
- production canary scorecards.

Evaluation must measure task outcome rather than hard-code one acceptable tool sequence unless the sequence itself is a safety/contract invariant.

### 5.5 Delivery / SRE Plane

Owns:

- build and release pipeline;
- runtime versioning;
- feature flags;
- preview/staging/canary;
- migrations;
- compatibility policy;
- rollback;
- failure taxonomy;
- SLOs.

---

## 6. Bounded Contexts and Ownership

| Bounded context | Owns | Does not own | Primary public contract |
|---|---|---|---|
| Experience | UI, file cards, status rendering, user interaction | semantic routing | `ExperienceEvent`, API calls |
| Gateway | auth, request admission, idempotency, lease, SSE | intent/capability choice | `TurnEnvelope` |
| Platform Kernel | turn/task/run lifecycle, budgets, deadlines, trace, outbox | domain semantics | `RunContext`, `RunOutcome` |
| Context | resolved state, recent context, project memory retrieval | durable enterprise evidence | `ContextSnapshot` |
| Agent Orchestration | controller decisions, re-plan, final/continue decision | provider internals, tool implementation | `ControllerDecision` |
| Capability | registry, manifests, candidate retrieval, contract lookup | actual semantic choice | `CapabilityCandidateSet` |
| Intelligence | provider adapters, model invocation, normalization | tool policy, grounding policy | `ModelRequest/ModelResponse` |
| Knowledge | source/object retrieval, exact/semantic/graph resolution | final claims/prose | `KnowledgeObservation` |
| Evidence | claims, provenance, coverage, conflict, evidence snapshots | tool selection | `EvidenceSnapshot` |
| Execution | execute authorized operation, timeout/retry/idempotency | semantic planning | `ExecutionRequest/Result` |
| Artifact | artifact contract, structure, revision, render/verify/persist | enterprise research | `ArtifactRequest/ArtifactResult` |
| Memory | durable decisions/corrections/progress/project facts | raw chat transcript as truth | `MemoryCandidate/MemoryRecord` |
| Evaluation | benchmark definitions/results | runtime decision authority | `EvaluationRun` |
| Telemetry | trace/span/metrics/cost/failure | execution behavior | `TelemetryEvent` |

### Boundary rule

A bounded context may depend on another context's **public contracts**, not its private implementation.

---

## 7. Platform Kernel

The Platform Kernel is the structural center of execution but **not** the semantic center.

### 7.1 Responsibilities

- assign/claim `turn_id`, `run_id`, `task_id`;
- create deadline and budget;
- initialize trace;
- maintain lifecycle state;
- coordinate synchronous execution;
- write transactional outbox events;
- enforce global invariants;
- terminate safely;
- persist execution metadata.

### 7.2 Kernel invariants

The kernel must be able to enforce, without understanding SAP, BA, CRM or user intent:

- maximum controller rounds;
- maximum provider calls;
- maximum tool calls;
- deadline exceeded;
- authorization denied;
- schema invalid;
- duplicate execution;
- stale lease;
- unsupported state transition;
- artifact not verified;
- persistence failure.

---

## 8. Agent Orchestration

The controller is a bounded component inside Agent Orchestration.

### 8.1 Controller owns

- semantic interpretation of the current goal;
- choosing among supplied capability candidates;
- deciding whether evidence is sufficient;
- deciding whether another capability is needed;
- deciding whether to finalize;
- generating semantic task parameters inside allowed contracts.

### 8.2 Controller does not own

- provider retry transport;
- provider fallback;
- tenant permissions;
- knowledge SQL/vector/graph strategy internals;
- evidence persistence;
- artifact file rendering;
- raw tool retry mechanics;
- deployment;
- cost ledger;
- memory storage policy.

### 8.3 Canonical controller decision

```ts
type ControllerDecision =
  | {
      kind: 'execute_capability'
      capabilityId: string
      arguments: unknown
      rationaleCode?: string
    }
  | {
      kind: 'finalize'
      answerIntent: 'text' | 'artifact_status' | 'mixed'
    }
  | {
      kind: 'request_user_input'
      missing: string[]
    }
```

`rationaleCode` is structured telemetry, not chain-of-thought.

### 8.4 Re-plan loop

```text
ContextSnapshot
 + CapabilityCandidateSet
 + EvidenceSnapshot?
 + Execution observations
 + Budget view
        |
        v
Controller
        |
        +--> execute capability
        |        |
        |        v
        |     ExecutionResult
        |        |
        |        v
        |   Evidence/State update
        |        |
        +--------+
        |
        +--> finalize
```

The loop lives in Agent Orchestration / Kernel coordination, not in provider adapters.

---

## 9. Intelligence / Model Platform

Provider code must be deliberately boring.

### 9.1 Provider adapter responsibilities

- authenticate against provider;
- map canonical request to provider API;
- stream or collect provider response;
- normalize usage;
- normalize tool/function call representation;
- return typed provider errors;
- honor explicit model selection.

### 9.2 Provider adapter forbidden behavior

Provider modules must not:

- hide capabilities based on task semantics;
- decide that knowledge is complete;
- inspect enterprise identifiers to authorize artifact content;
- choose a second model because a tool failed unless model policy explicitly instructed it outside the adapter;
- perform artifact grounding repair;
- select tools;
- mutate evidence;
- read/write project memory.

This rule directly eliminates the current `modelProvidersAgenticRuntimeV*` architectural drift.

### 9.3 Model Policy

Model escalation/fallback is a Governance + Agent/Kernel concern, represented explicitly:

```ts
type ModelPolicyDecision = {
  model: string
  provider: string
  reason:
    | 'user_selected'
    | 'controller_profile'
    | 'recovery_policy'
    | 'quality_policy'
}
```

Explicit provider selection remains isolated.

---

## 10. Capability Platform

A capability is not the same as a low-level tool.

### 10.1 Hierarchy

```text
DOMAIN
  └── CAPABILITY
        └── OPERATION
              └── EXECUTOR
                    └── ADAPTER
```

Example:

```text
Knowledge
  └── enterprise_research
        ├── resolve_targets
        ├── retrieve_sources
        ├── expand_relations
        └── build_observation
```

The controller selects `enterprise_research`; it does not need to understand Postgres queries, graph joins or chunk fetch implementations.

### 10.2 Capability descriptor

```ts
type CapabilityDescriptor = {
  id: string
  version: string
  description: string
  inputSchemaRef: string
  outputSchemaRef: string
  requiredPermissions: string[]
  evidenceMode: 'none' | 'produces' | 'requires'
  executionMode: 'sync' | 'async' | 'hybrid'
  riskClass: 'read' | 'write' | 'external_write' | 'privileged'
  costClass: 'low' | 'medium' | 'high'
}
```

### 10.3 Discovery

Semantic discovery returns top-K candidates. It never returns "must execute X".

---

## 11. Context and Memory Platform

Three layers remain distinct.

```text
RECENT CONVERSATION
        |
        v
RESOLVED CONVERSATION STATE
        |
        v
PROJECT MEMORY
```

### 11.1 ContextSnapshot

The controller receives a bounded immutable snapshot per round:

```ts
type ContextSnapshot = {
  conversationId: string
  workspaceId: string
  recentMessages: MessageRef[]
  resolvedState: ResolvedConversationState
  projectMemory: MemoryRef[]
  activeArtifact?: ArtifactRef
  attachments: AttachmentRef[]
  previousEvidence?: EvidenceSnapshotRef[]
}
```

### 11.2 Durable memory categories

- `DECISION`
- `CORRECTION`
- `PROGRESS`
- `PROJECT_FACT`
- `APPROVED_ARTIFACT_REF`

`AI_HYPOTHESIS` may exist as ephemeral state but does not automatically become durable project memory.

### 11.3 Memory update lifecycle

Memory persistence is post-turn:

```text
turn completed
   |
   v
Memory Candidate Extractor
   |
   v
Memory Policy Validator
   |
   +--> reject
   +--> persist
```

The controller may propose a memory candidate; it cannot directly write authoritative project facts.

---

## 12. Knowledge and Evidence Fabric

Knowledge retrieval and evidence validation are separate responsibilities.

### 12.1 Knowledge owns

- source catalog;
- uploaded document ingestion;
- parsing/chunking;
- knowledge object extraction;
- exact lookup;
- semantic retrieval;
- graph/relationship traversal;
- source detail retrieval.

### 12.2 Evidence owns

- claim/source linkage;
- provenance;
- scope;
- trust;
- freshness;
- conflicts;
- coverage;
- unresolved gaps;
- immutable evidence snapshots.

### 12.3 EvidenceSnapshot

Artifact and final-answer grounding use an immutable snapshot:

```ts
type EvidenceSnapshot = {
  id: string
  createdAt: string
  sourceRefs: string[]
  claims: VerifiedClaim[]
  identifiers: VerifiedIdentifier[]
  coverage: CoverageMap
  conflicts: EvidenceConflict[]
  assumptions: ExplicitAssumption[]
}
```

### 12.4 Key invariant

**Enterprise technical identifiers are data, not free-form artifact-generation vocabulary.**

Artifact generation receives an `evidenceSnapshotId` or typed evidence references. It must not rely on the model reproducing every identifier correctly inside a large free-form artifact payload.

### 12.5 Evidence critic

The critic produces:

```ts
type EvidenceCriticResult = {
  coverage: number
  gaps: string[]
  conflicts: string[]
  suggestedFocus: string[]
}
```

It cannot invoke or select another tool.

---

## 13. Execution Platform

Execution is a mechanical subsystem.

### 13.1 ExecutionRequest

```ts
type ExecutionRequest = {
  operationId: string
  runId: string
  workspaceId: string
  actorId: string
  idempotencyKey: string
  input: unknown
  permissions: string[]
  deadlineAt: string
}
```

### 13.2 ExecutionResult

```ts
type ExecutionResult =
  | { status: 'completed'; output: unknown; metrics: ExecutionMetrics }
  | { status: 'rejected'; reason: string }
  | { status: 'failed'; errorClass: string; retryable: boolean }
```

### 13.3 Retry ownership

- network/transient execution retry: Execution Platform;
- semantic re-plan after an observation: Agent Orchestration;
- provider HTTP retry: Intelligence adapter transport policy;
- business correction: Controller;
- artifact revision: Artifact Platform.

These retry types must never be collapsed into one generic "retry loop".

---

## 14. Artifact Platform

Artifact creation is its own bounded context.

### 14.1 Canonical flow

```text
ArtifactRequest
      |
      v
Load Artifact Contract
      |
      v
Build Canonical Structured Model
      |
      v
Evidence Binding Validation
      |
      v
Executor
      |
      +--> DOCX
      +--> XLSX
      +--> PPTX
      +--> PDF
      |
      v
Reload / Integrity Check
      |
      v
Persist Version
      |
      v
ArtifactResult
```

### 14.2 ArtifactRequest

```ts
type ArtifactRequest = {
  artifactType: string
  contractVersion: string
  evidenceSnapshotId?: string
  userRequirementRefs: string[]
  outputs: Array<'docx' | 'xlsx' | 'pptx' | 'pdf'>
  revisionOf?: string
  revisionScope?: string[]
}
```

The request should not duplicate the full evidence vocabulary.

### 14.3 Canonical Artifact Model

Structured content is distinct from file format:

```text
Verified facts / user requirements
            |
            v
Canonical Artifact Model
            |
       +----+----+----+----+
       |         |         |
       v         v         v
     DOCX      XLSX      PPTX ...
```

Multiple outputs are rendered from the same canonical model to prevent divergence.

### 14.4 Artifact state machine

```text
requested
  -> preparing
  -> validating
  -> executing
  -> verifying
  -> persisted
  -> completed
```

Failure states:

```text
validation_rejected
executor_failed
verification_failed
persistence_failed
cancelled
```

No failed state may emit a user-facing "ready/completed" result.

### 14.5 Revision invariant

A scoped revision carries an explicit allowed-change set. Unchanged sections must pass invariant verification before the new version is persisted.

---

## 15. Event Architecture

JETWORK must support long-running and cross-domain work without coupling every concern to the synchronous turn.

### 15.1 Canonical event families

```text
turn.started
turn.completed
turn.failed

context.resolved
controller.decision.created

capability.execution.started
capability.execution.completed
capability.execution.failed

knowledge.observation.created
evidence.snapshot.created
evidence.coverage.updated

artifact.requested
artifact.execution.started
artifact.generated
artifact.verified
artifact.persisted
artifact.failed

memory.candidate.created
memory.persisted
memory.rejected

evaluation.started
evaluation.completed

runtime.version.activated
runtime.rollback.executed
```

### 15.2 Delivery pattern

Initial implementation should use a **transactional outbox in Postgres**.

Business state change and event publication intent are committed atomically. Workers then dispatch/process events.

This avoids adding Kafka or another broker before it is justified while still preventing direct cross-domain function imports.

### 15.3 Event rules

- events are immutable;
- events contain IDs/refs, not entire sensitive payloads by default;
- consumers are idempotent;
- event schema is versioned;
- event handling failure does not corrupt source-domain state.

---

## 16. Synchronous vs Asynchronous Boundaries

### Synchronous by default

- request admission;
- turn claim;
- context snapshot;
- capability candidate retrieval;
- controller decision;
- bounded read-only knowledge retrieval;
- fast execution operations needed before the answer;
- final streaming response.

### Async/hybrid by default

- large document ingestion;
- graph enrichment;
- expensive multi-file artifact rendering;
- evaluation suites;
- telemetry aggregation;
- memory compaction;
- connector sync/index refresh;
- batch operations.

A synchronous user request may create an async job and stream durable job status instead of holding one Edge request open indefinitely.

---

## 17. Logical Data Architecture

Physical storage may remain Postgres/Supabase initially. Ownership is logical and enforced by schema/access boundaries.

### 17.1 Operational schema

Owns:

- conversations;
- messages;
- turns;
- runs;
- tasks;
- leases;
- budgets;
- execution state.

### 17.2 Context / Memory schema

Owns:

- resolved conversation state;
- memory records;
- corrections;
- decisions;
- progress state;
- memory authority metadata.

### 17.3 Knowledge schema

Owns:

- sources;
- source versions;
- documents;
- chunks;
- knowledge objects;
- graph relations;
- indexing metadata.

### 17.4 Evidence schema

Owns:

- evidence snapshots;
- claims;
- claim-source refs;
- coverage;
- conflicts;
- assumptions.

### 17.5 Artifact schema

Owns:

- artifacts;
- artifact versions;
- canonical artifact model;
- artifact sections;
- evidence refs;
- execution/verification results.

### 17.6 Platform schema

Owns:

- capability registry;
- runtime versions;
- feature flags;
- model policy metadata;
- connector metadata.

### 17.7 Telemetry / Evaluation schema

Owns:

- traces;
- spans;
- controller rounds;
- provider calls;
- execution calls;
- usage/cost;
- failure taxonomy;
- golden suites;
- evaluation runs.

---

## 18. Security Boundaries

### 18.1 Workspace boundary

Every resource must resolve through `workspace_id` or equivalent tenant ownership.

### 18.2 Capability authorization

Authorization is evaluated before execution using:

- actor;
- workspace;
- capability/operation;
- resource;
- action risk class.

The controller cannot grant itself permissions.

### 18.3 External write actions

External writes require explicit risk classification. Depending on policy they may require:

- user confirmation;
- human approval;
- dual control;
- immutable audit.

### 18.4 Evidence trust

Retrieved content is untrusted input until normalized into evidence. Source text cannot issue system instructions to the runtime.

---

## 19. Observability Contract

A single `trace_id` connects the full user-visible transaction.

Required spans:

```text
request_to_claim
claim_to_context
context_to_controller
capability_discovery_latency
controller_decision_latency
tool_latency
replan_latency
final_generation_ttft
stream_duration
total_turn
```

Required structured dimensions include:

- runtime version;
- git SHA;
- controller version/model;
- provider;
- controller round;
- candidate capabilities;
- selected capability;
- execution result;
- evidence snapshot ID;
- evidence coverage;
- artifact lifecycle state;
- termination reason;
- provider/token/cost usage;
- failure taxonomy.

No chain-of-thought text is logged.

---

## 20. Evaluation and Release Gates

Quality gates remain before optimization.

### 20.1 Evaluation layers

```text
UNIT / DETERMINISTIC
        |
        v
CONTRACT / STATE
        |
        v
GOLDEN RUNTIME
        |
        v
LIVE-LIKE E2E
        |
        v
CANARY
```

### 20.2 Quality metrics

- task success;
- grounded technical claims;
- unsupported claims;
- source/citation accuracy;
- retrieval recall;
- artifact integrity;
- state continuity;
- provider isolation;
- authorization correctness.

### 20.3 Performance/cost metrics

Only after quality floor is met:

- P50/P95 TTFT;
- P50/P95 total latency;
- P50/P95 controller rounds;
- P50/P95 capability executions;
- provider calls / successful turn;
- cost / completed turn;
- cost / successful grounded answer.

### 20.4 Release chain

```text
feature branch
  -> unit/contract
  -> golden
  -> preview
  -> Supabase test/staging
  -> live-like E2E
  -> PR ready
  -> main
  -> production edge
  -> frontend production
  -> smoke
  -> canary
  -> progressive rollout
```

Rollback must be possible through one runtime/config change without emergency code edits.

---

## 21. Deployment Topology

### 21.1 Current target physical topology

```text
Browser / Mobile Web
        |
        v
Vercel Frontend
        |
        v
Supabase Edge Gateway / Runtime
        |
        +--> Postgres
        +--> Storage
        +--> Knowledge/Artifact Edge Workers
        +--> Provider APIs
        +--> External Connectors
```

### 21.2 Logical vs physical service rule

The following are **logical services** immediately:

- gateway;
- runtime kernel;
- context;
- capability;
- agent orchestration;
- intelligence;
- knowledge;
- evidence;
- execution;
- artifact;
- telemetry/evaluation.

They do not each require an independent deployment on day one.

Physical extraction happens when one of these is true:

- different scaling profile;
- long-running workload;
- separate security boundary;
- independent release cadence;
- fault isolation requirement;
- unacceptable blast radius.

Artifact execution and ingestion workers are early candidates for physical separation because they have materially different latency and compute characteristics from interactive chat.

---

## 22. Target Repository Structure

Target logical structure:

```text
supabase/functions/
  assistant-gateway/
  runtime-worker/
  artifact-worker/
  knowledge-worker/

  _shared/platform/
    contracts/
    kernel/
    agent/
    context/
    capability/
    intelligence/
    knowledge/
    evidence/
    execution/
    artifact/
    memory/
    trust/
    governance/
    telemetry/
    events/
```

### 22.1 Contracts are first-class

All cross-context types live under `contracts/`.

No bounded context may import another bounded context's private files.

### 22.2 Compatibility adapters

Temporary migration adapters belong in:

```text
_shared/platform/compat/
```

Compatibility files have:

- owner;
- source system;
- target contract;
- removal condition;
- expiry milestone.

A permanent `V2 -> V3 -> V4 -> V5` export inheritance chain is prohibited.

---

## 23. Dependency Rules

### Allowed

```text
gateway -> contracts, kernel
kernel -> contracts, governance, telemetry
agent -> contracts, intelligence interface, capability interface
context -> contracts, memory interface
capability -> contracts
knowledge -> contracts, execution primitives
evidence -> contracts
artifact -> contracts, execution interface, evidence read interface
intelligence -> contracts
execution -> contracts, adapters
telemetry -> contracts
```

### Forbidden examples

```text
intelligence -> artifact implementation
intelligence -> knowledge implementation
provider adapter -> evidence validator
gateway -> semantic router
artifact executor -> controller
evidence critic -> tool executor
frontend -> natural-language routing
knowledge adapter -> project memory mutation
```

Architecture tests must enforce these import rules.

---

## 24. Failure Model

Failure classes are domain-neutral and typed.

Initial taxonomy:

- `AUTH_FAILURE`
- `TURN_CLAIM_CONFLICT`
- `CONTEXT_RESOLUTION_FAILURE`
- `CONTROLLER_PROVIDER_FAILURE`
- `CAPABILITY_DISCOVERY_FAILURE`
- `CAPABILITY_AUTHORIZATION_FAILURE`
- `KNOWLEDGE_EXECUTION_FAILURE`
- `EVIDENCE_VALIDATION_FAILURE`
- `ARTIFACT_VALIDATION_FAILURE`
- `ARTIFACT_EXECUTOR_FAILURE`
- `ARTIFACT_VERIFICATION_FAILURE`
- `STREAM_TRANSPORT_FAILURE`
- `PERSISTENCE_FAILURE`
- `BUDGET_EXHAUSTED`
- `TIMEOUT`
- `PROVIDER_POLICY_VIOLATION`

Failures are observations. A semantic recovery decision, when allowed, belongs to Agent Orchestration; transport/mechanical retry belongs to the owning subsystem.

---

## 25. Architecture Fitness Functions

CI must fail when architectural constraints regress.

Minimum fitness functions:

1. Gateway cannot import semantic routing/controller implementation.
2. Provider adapters cannot import artifact/knowledge/evidence implementation.
3. Evidence critic cannot import executor.
4. Artifact executor cannot invoke LLM/controller.
5. Cross-bounded-context imports must target `contracts/` or explicit interfaces.
6. Compatibility wrapper chain depth is bounded and trends to zero.
7. New runtime version files cannot merely re-export prior versions as permanent architecture.
8. Explicit provider choice cannot produce a call to another provider.
9. Artifact `completed` state requires verified persisted output.
10. Durable `PROJECT_FACT` requires authority/evidence or explicit user source.
11. Every execution request carries workspace and actor context.
12. Every turn carries runtime version + SHA + trace ID.
13. Every async event consumer is idempotent.
14. Architecture dependency graph is acyclic.

---

## 26. Current Code: Keep / Move / Rewrite / Delete

This matrix is architectural, not a blanket code judgement.

### KEEP and harden

- `_shared/context/conversationState.ts`
- `_shared/context/resolvedContext.ts`
- `_shared/context/projectMemory.ts`
- `_shared/context/projectMemoryStore.ts`
- `_shared/context/stateReducer.ts`
- `_shared/artifact/stateMachine.ts`
- `_shared/artifact/revisionInvariant.ts`
- `_shared/artifact/storageVerifier.ts`
- `_shared/artifact/officeRevisionVerifier.ts`
- existing auth/RLS/lease/idempotency primitives;
- provider isolation behavior;
- golden/evaluation infrastructure;
- existing artifact verification concepts.

These already align with System Architecture V2 at the responsibility level, though interfaces may need normalization.

### MOVE behind public contracts

- capability registry/discovery;
- controller policy/state;
- knowledge tools;
- evidence mapping;
- artifact execution tools;
- telemetry emission;
- model policy.

### REWRITE responsibility boundaries

- `modelProvidersAgenticRuntimeV*`: collapse back to provider adapter responsibilities; remove semantic recovery, tool hiding, artifact grounding preflight and task-policy logic.
- `assistantToolsAgenticRuntimeV*`: split capability contract, execution adapter and evidence/artifact responsibilities.
- gateway code that performs semantic planning/routing.
- artifact calls that serialize enterprise evidence into free-form model arguments.

### DELETE after migration

- version-wrapper chains whose sole purpose is layering patches;
- semantic keyword/domain/exact-id routing outside controller;
- frontend natural-language artifact routing;
- duplicate grounding validators;
- provider-level controller recovery;
- legacy semantic fast paths once rollout completes.

### QUARANTINE

PR #205 and canary V61 are diagnostic/migration inputs, not the architecture baseline.

Useful behaviors may be extracted, but the wrapper topology itself must not be merged into the final V2 architecture unchanged.

---

## 27. Migration Workstreams

System Architecture V2 migration is organized by structural risk, not by feature name.

### SA0 — Architecture Baseline

- approve this document;
- add dependency/fitness tests;
- add ADR template;
- freeze new semantic logic in provider/gateway/compatibility layers.

**Exit:** architectural violations can no longer grow silently.

### SA1 — Contracts & Kernel

Create canonical:

- `TurnEnvelope`
- `RunContext`
- `ControllerDecision`
- `CapabilityDescriptor`
- `ExecutionRequest/Result`
- `ContextSnapshot`
- `EvidenceSnapshot`
- `ArtifactRequest/Result`
- telemetry/event contracts.

Extract turn/run/budget/deadline coordination into kernel.

**Exit:** core modules communicate through versioned contracts.

### SA2 — Intelligence Boundary Cleanup

Collapse provider wrapper stack.

Move:

- semantic re-plan -> Agent;
- task recovery -> Agent;
- artifact grounding -> Evidence/Artifact;
- tool authorization -> Execution/Trust;
- model escalation policy -> Governance/Agent.

**Exit:** provider adapters are transport/normalization only.

### SA3 — Capability & Agent Boundary

- controller receives candidate set;
- capability selection remains LLM semantic decision;
- capability registry/discovery becomes independent service/module;
- controller loop moves out of provider implementations.

**Exit:** one semantic controller authority with mechanical runtime.

### SA4 — Evidence Fabric

- immutable evidence snapshots;
- claim/source model;
- coverage/conflict model;
- evidence API;
- single grounding policy implementation.

**Exit:** evidence can be consumed by text and artifact workflows without copying free-form research text.

### SA5 — Artifact Platform

- canonical artifact model;
- `evidenceSnapshotId` binding;
- multi-output rendering from one canonical model;
- async-capable artifact job;
- reload/integrity gate;
- revision invariant.

**Exit:** DOCX/XLSX multi-artifact flow cannot invent identifiers by construction.

### SA6 — Events & Async Workers

- Postgres outbox;
- artifact/ingestion/evaluation workers;
- idempotent consumers;
- job status events.

**Exit:** long-running work no longer stretches the interactive turn runtime.

### SA7 — Data Ownership & Security

- logical schemas/ownership;
- repository/service boundaries;
- capability authorization;
- audit and external-write approval.

**Exit:** bounded-context and tenant boundaries are enforceable, not conventions.

### SA8 — Evaluation, Performance, Rollout

- full golden suite;
- architecture fitness suite;
- quality baseline;
- P7 latency/cost baseline on exact SHA;
- canary;
- rollout;
- rollback proof.

**Exit:** production runtime meets quality, architecture, performance and operational gates.

---

## 28. Immediate Sequence

The next implementation should **not** be another V57 artifact preflight patch.

Order:

```text
SA0 Architecture fitness
  ->
SA1 Contracts / Kernel skeleton
  ->
SA2 Provider boundary cleanup
  ->
SA3 Controller / Capability boundary
  ->
SA4 EvidenceSnapshot
  ->
SA5 Artifact platform
```

Only after SA5 should the blocked multi-artifact acceptance scenario become a production gate again.

This prevents optimizing or debugging behavior whose ownership boundary is being replaced.

---

## 29. Architecture Decision Records to Create

- **ADR-10:** JETWORK is a modular platform, not an agent-loop application.
- **ADR-11:** Logical bounded contexts precede physical microservice decomposition.
- **ADR-12:** Provider adapters are transport/normalization only.
- **ADR-13:** Kernel coordinates lifecycle but has no domain semantics.
- **ADR-14:** Enterprise technical grounding uses immutable EvidenceSnapshot.
- **ADR-15:** Artifact outputs render from one canonical artifact model.
- **ADR-16:** Cross-context async integration uses transactional outbox initially.
- **ADR-17:** Retry ownership is separated by failure type.
- **ADR-18:** Architecture fitness functions are CI gates.
- **ADR-19:** Compatibility wrappers are temporary, owned and expiring.
- **ADR-20:** PR #205/V61 are migration evidence, not final architecture.

The original Master Plan ADRs remain valid where they do not conflict with this system-level structure.

---

## 30. Definition of Done for System Architecture V2

System Architecture V2 is considered implemented only when:

- bounded contexts exist as enforceable code boundaries;
- public contracts are versioned and used for cross-context interaction;
- gateway is semantically inert;
- provider adapters contain no task semantic policy;
- controller loop is owned by Agent Orchestration;
- capability discovery does not choose capabilities;
- context and project memory are separate from raw history;
- EvidenceSnapshot is immutable and shared across answer/artifact paths;
- artifact rendering consumes evidence references rather than hallucination-prone free-form identifiers;
- artifact completion requires render + reload + integrity + persistence;
- async jobs use idempotent event/outbox patterns;
- security and workspace context reach every execution;
- telemetry traces the complete turn;
- architecture fitness tests are green;
- golden quality gates pass;
- performance/cost optimization starts only after quality floor;
- canary and rollback are proven.

---

## 31. Final Invariant

The system should be explainable by the following sentence:

> **JETWORK is an enterprise AI platform in which product experiences invoke a governed platform kernel; an LLM controller makes semantic decisions over bounded context and capability contracts; deterministic runtime components execute, authorize, persist and observe; knowledge is converted into immutable evidence; artifacts and actions consume that evidence through typed contracts; and quality, security, cost and rollout are enforced by independent control planes.**

That is the architectural baseline for JETWORK System Architecture V2.
