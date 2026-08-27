import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Runtime regression: a model must not finalize an artifact turn before the
// semantic execution contract has produced a real executor-backed artifact.
const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const executionToolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/executionTools.ts', import.meta.url),
  'utf8',
)

describe('Semantic artifact runtime completion guard', () => {
  it('keeps enough tool rounds for inspect and execution workflows', () => {
    expect(coreSource).toMatch(/ASSISTANT_V2_MAX_TOOL_ROUNDS', 5, 1, 6/)
  })

  it('does not accept a final response while the semantic artifact contract is still pending', () => {
    expect(coreSource).toContain('semanticArtifactRequired')
    expect(coreSource).toContain('generatedArtifacts.size === 0')
    expect(coreSource).toContain('SEMANTIC_ARTIFACT_REQUIRED')
    expect(coreSource).toContain("plan.executionMode !== 'artifact'")
    expect(coreSource).not.toContain('spreadsheetSyncRequested')
    expect(coreSource).not.toContain('SPREADSHEET_SYNC_REQUIRED')
  })

  it('treats a non-empty attachment list as authoritative execution availability', () => {
    expect(executionToolsSource).toMatch(/If records are returned, the files are available/)
    expect(executionToolsSource).toMatch(/Do not stop after inspection/)
    expect(executionToolsSource).toMatch(/do not claim files are missing/)
  })
})
