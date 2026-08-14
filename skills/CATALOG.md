# JetWork Capability Catalog v2

Capability System v2 defines **242 baseline skills across 20 families**. Existing curated `/skills/**/SKILL.md` entries remain richer runtime overrides for matching keys.

A catalog entry has a readiness state:

- `defined`: procedure exists.
- `executable`: a real runtime path exists.
- `verified`: executable path has regression/live proof for the advertised contract.

Do not infer execution support from the presence of a skill alone.

## Family inventory

| Family | Skill count | Runtime character |
|---|---:|---|
| Agent / Orchestration | 12 | model/runtime orchestration |
| Reasoning / Decision | 10 | model reasoning |
| Knowledge / RAG / Grounding | 16 | enterprise evidence tools |
| Web / Research | 10 | provider/web research |
| Data Analysis | 12 | analysis/reconciliation |
| File Intelligence | 10 | action-file discovery/inspect |
| Spreadsheet | 24 | XLSX inspect/edit/transform/create/QA + Jira sync |
| PDF | 12 | inspect + merge/split; other mutations readiness-gated |
| Word / Documents | 12 | OOXML inspect, safe text edit, generation |
| Presentation | 12 | OOXML inspect, basic edit, generation |
| Image / Vision | 12 | multimodal inspect + image generation/edit |
| Business Analysis | 22 | requirements/process/impact/solution analysis |
| Process / Architecture | 10 | flow/context/sequence/topology analysis |
| Agile / Jira / Product | 16 | export, status, sprint, capacity, roadmap |
| SAP / Enterprise Technical | 10 | evidence-grounded object/code/process diagnosis |
| Engineering / Code | 10 | repo/bug/change/test/review workflows |
| Artifact Generation | 8 | file creation/edit/delivery lifecycle |
| Automation / Actions | 8 | defined; side effects require connected action backend |
| Communication | 8 | audience-aware business communication |
| Quality / Verification | 8 | factual/completeness/calculation/artifact QA |
| **Total** | **242** | |

The generated baseline is `supabase/functions/_shared/skillRegistry.v2.ts`; readiness is `supabase/functions/_shared/capabilityManifest.ts`.

## Spreadsheet executor v2

Real tool surface:

- `list_spreadsheet_attachments`
- `inspect_spreadsheet_file`
- `edit_spreadsheet_file`
- `transform_spreadsheet_file`
- `create_spreadsheet_file`
- `validate_spreadsheet_file`
- `sync_spreadsheet_with_jira_export`

Allow-listed direct edits currently include values, formulas, fill colors, bold/font size, cell merge, filter, freeze pane and sheet addition. Transform supports sort, filter, deduplicate, clean, normalize, aggregate and exact join. Unsupported advanced spreadsheet skills such as arbitrary pivot/chart/conditional-formatting remain `defined` until a dedicated executor is added and tested.

## Multi-format artifact executor v2

Real tool surface:

- `list_action_attachments`
- `inspect_file_attachment`
- `transform_pdf_file`
- `edit_office_file`
- `create_document_file`
- `generate_or_edit_image`

Supported action-file storage includes XLSX, PDF, DOCX, PPTX, common images, CSV/TSV/TXT/MD/JSON. All binary inputs are private workspace-scoped `tool_input` objects and generated files return as `tool_output` artifacts.

### PDF

Executable: multimodal inspect, merge, split. Other catalog items stay readiness-gated.

### DOCX

Executable: OOXML text/structure inspect, exact text replacement, safe append for DOCX, and document generation. Exact replacement intentionally fails when source text cannot be located safely rather than silently corrupting content.

### PPTX

Executable: slide text/structure inspect, exact text replacement when the OOXML run is matchable, and deterministic basic slide generation. Arbitrary preservation-aware visual redesign is not claimed by this executor.

### Image

Executable: multimodal inspect and provider-backed image generation/edit. Generated images use the same private artifact delivery path as office files.

## Capability discovery

The model receives:

- `search_skills` — semantic/procedural discovery.
- `load_skills` — lazy-load up to the relevant procedures.
- `list_capabilities` — readiness-aware self-inspection.

This keeps the global prompt small while preventing “skill exists, therefore I executed it” errors.

## Evidence boundary

Skills and execution results are procedural/action context, **not enterprise evidence**. SAP and enterprise technical facts still require verified knowledge objects/relations. Web-current facts still require the normal research path. Artifact execution cannot satisfy grounding by itself.

## Completion guards

For real file work, core runtime has completion contracts:

- Jira/XLSX sync cannot finish before `sync_spreadsheet_with_jira_export`.
- Generic XLSX edit cannot finish before `edit_spreadsheet_file` or `transform_spreadsheet_file`.
- New XLSX creation cannot finish before `create_spreadsheet_file`.
- PDF/DOCX/PPTX/Image mutation/generation cannot finish before the matching artifact executor.

If the required executor is absent or fails, JetWork must report non-completion instead of claiming success or issuing a generic false refusal.
