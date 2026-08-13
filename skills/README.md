# JetWork Skill Library

JetWork skills are lazy-loaded procedural playbooks. They describe **how to perform a class of work**; they are not user data, enterprise evidence, or citations.

## Target runtime

1. The primary LLM receives only compact skill-discovery capability.
2. For a specialized task, it searches the skill catalog.
3. It loads only the relevant `SKILL.md` playbooks.
4. It follows those procedures while using normal JetWork tools/RAG.
5. Evidence and skill instructions remain separate: knowledge proves facts; skills govern workflow.

This lets JetWork grow to 100+ skills without putting all instructions into the global system prompt and without locking the product to OpenAI or Gemini.

## Canonical layout

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

## Skill contract

Every skill must contain:

- machine-readable metadata,
- purpose,
- use / do-not-use rules,
- deterministic procedure,
- validation,
- output contract,
- failure handling.

Start from `skills/SKILL_TEMPLATE.md`.

## Priorities

- **P0**: runtime-critical, high-frequency capability.
- **P1**: important domain workflow.
- **P2**: specialized or lower-frequency workflow.

## Safety rules

- A skill must never invent enterprise facts.
- A skill may require knowledge/web/file tools, but those tools remain the source of truth.
- Search candidates are not evidence until a detail/evidence tool verifies them.
- Skills should be composable; avoid one giant “do everything” skill.
- Validation belongs inside the skill, not only in the global prompt.
