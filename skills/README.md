# JetWork Skill Library — Capability System v2

JetWork skills are lazy-loaded procedural playbooks. They describe **how to perform a class of work**; they are not user data, enterprise evidence, citations, or proof that a binary action executor exists.

## Master model

Capability System v2 separates four concerns:

```text
Skill -> Executor/Tool -> Validation -> Artifact/Answer
```

- **Skill**: how the task should be performed.
- **Executor/Tool**: the real operation (file mutation, knowledge lookup, web research, connector action, etc.).
- **Validation**: evidence, data, format and delivery checks.
- **Artifact/Answer**: the user-visible result.

A skill definition alone must never cause JetWork to claim that an operation was executed.

## Readiness states

Every runtime capability exposes one of three states:

- **defined** — procedural skill exists, but no complete direct executor is wired yet.
- **executable** — a real model/provider/tool/executor path exists.
- **verified** — executable path also has a trusted regression/live proof for its advertised contract.

`list_capabilities` exposes these states to the assistant so it can reason about its own capabilities without overclaiming.

## Runtime discovery

1. The primary model receives compact discovery tools, not 200+ full playbooks.
2. It uses `search_skills` when a specialized procedure would help.
3. It uses `load_skills` for only the selected procedures.
4. It uses `list_capabilities` when readiness/self-awareness matters.
5. It executes the relevant normal JetWork tools.
6. Runtime guards prevent final answers when a real artifact operation was requested but its required executor did not complete.
7. Evidence and procedural instructions remain separate: **knowledge proves facts; skills govern workflow**.

## Catalog structure

Capability System v2 provides a generated 20-family baseline under `supabase/functions/_shared/skillRegistry.v2.ts`. Existing curated `/skills/**/SKILL.md` procedures remain richer overrides for keys that are already materialized.

The 20 families are:

`agent`, `reasoning`, `knowledge`, `research`, `data`, `files`, `spreadsheet`, `pdf`, `document`, `presentation`, `image`, `business-analysis`, `architecture`, `jira`, `sap`, `engineering`, `artifact`, `automation`, `communication`, `quality`.

## Curated layout

```text
skills/
  spreadsheet/
    inspect/SKILL.md
    table-join/SKILL.md
  jira/
    export-analysis/SKILL.md
  business-analysis/
  sap/
  engineering/
```

Curated skills should be added when a generic V2 procedure needs domain-specific precision, richer validation, or a critical regression contract.

## Skill contract

Every curated skill should contain:

- metadata,
- purpose,
- use / do-not-use rules,
- deterministic procedure,
- validation,
- output contract,
- failure handling.

Start from `skills/SKILL_TEMPLATE.md`.

## Safety rules

- Skills never invent enterprise facts.
- Skill text is never a citation source.
- Search candidates are not evidence until the normal evidence path verifies them.
- Execution-only tool results do not become enterprise evidence.
- Binary mutation is allow-listed; no `eval` or arbitrary code execution is permitted in artifact workers.
- `defined` must never be described as “I can do this directly.”
- Critical artifact work should finish with reload/integrity QA before delivery.
