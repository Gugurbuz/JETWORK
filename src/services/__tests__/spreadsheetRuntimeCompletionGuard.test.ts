import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const executionToolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/executionTools.ts', import.meta.url),
  'utf8',
)

describe('Spreadsheet runtime completion guard', () => {
  it('keeps enough tool rounds for list, inspect and mutation workflows', () => {
    expect(coreSource).toMatch(/ASSISTANT_V2_MAX_TOOL_ROUNDS', 5, 1, 6/)
  })

  it('does not accept a final response while a requested Jira spreadsheet sync is still pending', () => {
    expect(coreSource).toMatch(/spreadsheetSyncRequested/)
    expect(coreSource).toMatch(/spreadsheetAttachmentsAvailable/)
    expect(coreSource).toMatch(/spreadsheetSyncCompleted/)
    expect(coreSource).toMatch(/SPREADSHEET_SYNC_REQUIRED/)
    expect(coreSource).toMatch(/sync_spreadsheet_with_jira_export/)
    expect(coreSource).toMatch(/Dosyaların eksik olduğunu söyleme/)
  })

  it('treats a non-empty attachment list as authoritative execution availability', () => {
    expect(executionToolsSource).toMatch(/If records are returned, the files are available/)
    expect(executionToolsSource).toMatch(/Do not stop after inspection/)
    expect(executionToolsSource).toMatch(/do not claim files are missing/)
  })
})
