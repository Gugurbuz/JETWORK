# Skill: <category>/<skill-key>

## Metadata

```json
{
  "key": "<category>/<skill-key>",
  "title": "<Human title>",
  "category": "<category>",
  "priority": "P1",
  "description": "<One sentence describing the capability>",
  "aliases": ["<search phrase>"],
  "tools": ["<capability/tool family>"]
}
```

## Purpose

Explain the result this skill is responsible for.

## Use when

- Trigger condition.

## Do not use when

- Boundary or counter-example.

## Procedure

1. Deterministic first step.
2. Continue with the minimum necessary work.
3. Keep fact retrieval separate from procedural instruction.

## Validation

- Concrete check that must pass before completion.

## Output contract

- What the caller/user receives.

## Failure handling

- How to fail safely without inventing data.
