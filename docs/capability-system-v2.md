# JetWork Capability System v2

## Objective

JetWork is not a document-only assistant. Capability System v2 gives one runtime model for reasoning, knowledge, research, data, files/artifacts, business analysis, Jira/Product, SAP and engineering workflows.

The architecture is:

```text
User intent
   ↓
Capability discovery
   ↓
Skill procedure
   ↓
Evidence / Executor / Connector
   ↓
Validation
   ↓
Answer or tool_output artifact
```

## Four contracts

### 1. Skill contract

A skill is trusted procedural guidance. It defines purpose, procedure, validation and failure behavior. It never proves an enterprise fact and never implies that a binary action was executed.

### 2. Readiness contract

Runtime exposes `defined`, `executable`, and `verified` states through `capabilityManifest.ts` and `list_capabilities`.

This is intentionally conservative: a skill can exist before its direct executor is available.

### 3. Executor contract

Binary or side-effecting work must use an allow-listed executor. Executor results are execution-only and `citationReady:false`.

Current dedicated workers:

- `spreadsheet-execute`: XLSX inspect, edit, transform, create, validate, Jira sync.
- `artifact-execute`: file inspect, PDF merge/split, safe DOCX/PPTX text mutation and creation, image generation/edit.

### 4. Delivery contract

Generated files are saved under the private `assistant-files` bucket in user/workspace scoped paths. Model-visible tool output contains only safe artifact metadata. The assistant message carries a `tool_output` reference and the UI mints a fresh short-lived signed URL when the user clicks the file card.

## Action-file lifecycle

```text
Upload
  ↓
tool_input
  ↓
assistant-files/{user}/{workspace}/inputs/...
  ↓
list / inspect
  ↓
executor
  ↓
reload/integrity QA
  ↓
assistant-files/{user}/{workspace}/outputs/...
  ↓
tool_output
  ↓
secure file card
```

Supported action-file types in v2 storage policy:

- XLSX
- PDF
- DOCX
- PPTX
- PNG/JPEG/WebP/GIF/SVG
- CSV/TSV/TXT/MD/JSON

## Spreadsheet execution

`edit_spreadsheet_file` handles bounded direct workbook edits. `transform_spreadsheet_file` handles deterministic table transformations. Create and validate are separate tools so model intent does not become arbitrary code.

The worker enforces file size, workspace scope, action count/cell limits, operation allow-lists and reload QA. It does not use `eval` or `new Function`.

## Artifact execution

PDF, Office and image execution use format-specific controlled operations. Complex capabilities that are not implemented remain `defined` in the readiness manifest rather than being falsely advertised as executable.

## Orchestration completion guards

The core identifies explicit artifact intent and refuses to accept a normal final model answer when a required executor has not run. It re-enters the tool loop while budget remains. At budget exhaustion it reports non-completion instead of fabricating success.

This applies to:

- Jira spreadsheet sync,
- generic spreadsheet mutation,
- spreadsheet creation,
- PDF mutation,
- DOCX/PPTX mutation or creation,
- image generation/edit.

## Grounding separation

Capability System v2 does not weaken enterprise grounding:

- skills are not evidence,
- execution results are not evidence,
- web facts use normal web grounding,
- SAP identifiers and enterprise claims still require verified enterprise knowledge when the request is factual,
- artifacts can contain analysis derived from evidence but do not become evidence merely because JetWork created them.

## Regression strategy

The master regression suite checks:

- 20 families / 242 V2 skills,
- unique runtime keys,
- curated skill override precedence,
- natural-language skill discovery,
- readiness separation,
- full executor tool exposure,
- action-file routing and UI artifact cards,
- no dynamic code execution in workers,
- completion guard presence,
- existing grounding/BA/spreadsheet Jira behavior through the normal CI suite.

## Production rollout order

1. Merge only after full CI green and latest-main reconciliation.
2. Apply the action MIME migration.
3. Pin `spreadsheet-execute`, `artifact-execute`, and `openai-assistant-core-v2` to the final main SHA.
4. If gateway source changed, pin the live assistant gateway to the same final code revision.
5. Deploy frontend from final main.
6. Verify production domain/build/runtime errors.
7. Treat new executors as `executable` until a real production canary proves the advertised workflow; then promote readiness to `verified`.
