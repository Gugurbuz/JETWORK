import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_EXECUTION_TOOLS,
  executeExecutionTool,
  isExecutionTool,
} from '../../../supabase/functions/_shared/executionTools.ts'
import {
  pickLatestSprint,
  planSpreadsheetJiraSync,
} from '../../../supabase/functions/_shared/spreadsheetTransform.ts'
import {
  ASSISTANT_SKILL_TOOLS,
  isSkillTool,
} from '../../../supabase/functions/_shared/skillTools.ts'
import { resultHasVerifiedKnowledgeEvidence } from '../../../supabase/functions/_shared/groundingGuard.ts'

const assistantToolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)
const workerSource = readFileSync(
  new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url),
  'utf8',
)
const messageRepositorySource = readFileSync(
  new URL('../messageRepository.ts', import.meta.url),
  'utf8',
)
const chatPanelSource = readFileSync(
  new URL('../../components/ChatPanel.tsx', import.meta.url),
  'utf8',
)
const useMessagesSource = readFileSync(
  new URL('../../hooks/useMessages.ts', import.meta.url),
  'utf8',
)
const assistantRuntimeClientSource = readFileSync(
  new URL('../assistantRuntimeClient.ts', import.meta.url),
  'utf8',
)
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260814091412_create_assistant_files_bucket.sql', import.meta.url),
  'utf8',
)
const hardeningMigrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260814091641_harden_assistant_files_permanent_users.sql', import.meta.url),
  'utf8',
)

describe('Spreadsheet Execution Layer', () => {
  it('selects the numerically latest matching EN-Fast sprint', () => {
    expect(pickLatestSprint([
      'Sprint 999',
      'EN-Fast Sprint 92, EN-Fast Sprint 104',
      'EN-Fast Sprint 101',
    ], 'EN-Fast')).toBe('EN-Fast Sprint 104')
  })

  it('plans Jira status and sprint updates without mutating source tables', () => {
    const target = {
      headerRow: 2,
      headers: ['Jira No', 'Durum', 'Açıklama'],
      rows: [
        ['ABC-1', 'Devam', 'Birinci'],
        ['ABC-2', 'Devam', 'İkinci'],
        ['ABC-3', 'Devam', 'Üçüncü'],
      ],
    }
    const jira = {
      headerRow: 1,
      headers: ['Key', 'Status', 'Sprint'],
      rows: [
        ['ABC-1', 'Done', 'EN-Fast Sprint 98'],
        ['ABC-1', 'Closed', 'EN-Fast Sprint 102'],
        ['ABC-2', 'In Progress', 'EN-Fast Sprint 99'],
      ],
    }

    const plan = planSpreadsheetJiraSync(target, jira, {
      targetKeyColumn: 'Jira No',
      jiraKeyColumn: 'Key',
      jiraStatusColumn: 'Status',
      targetStatusColumn: 'Durum',
      doneStatuses: ['Done', 'Closed'],
      completedValue: 'Tamamlandı',
      jiraSprintColumn: 'Sprint',
      targetSprintColumn: 'Enfast Sprint',
      sprintNamePattern: 'EN-Fast',
    })

    expect(plan.targetSprintColumnCreated).toBe(true)
    expect(plan.matchedRows).toBe(2)
    expect(plan.unmatchedRows).toBe(1)
    expect(plan.completedRows).toBe(1)
    expect(plan.sprintRows).toBe(2)
    expect(plan.duplicateJiraKeys).toBe(1)
    expect(plan.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, column: 2, value: 'Tamamlandı', reason: 'status' }),
      expect.objectContaining({ row: 3, column: 4, value: 'EN-Fast Sprint 102', reason: 'sprint' }),
      expect.objectContaining({ row: 4, column: 4, value: 'EN-Fast Sprint 99', reason: 'sprint' }),
    ]))
    expect(target.headers).toEqual(['Jira No', 'Durum', 'Açıklama'])
  })

  it('exposes list, inspect and Jira sync capabilities while keeping them out of the pure skill executor', () => {
    const executionNames = ASSISTANT_EXECUTION_TOOLS.map(tool => tool.name)
    expect(executionNames).toEqual([
      'list_spreadsheet_attachments',
      'inspect_spreadsheet_file',
      'sync_spreadsheet_with_jira_export',
    ])
    expect(ASSISTANT_SKILL_TOOLS.map(tool => tool.name)).toEqual(expect.arrayContaining(executionNames))
    for (const name of executionNames) {
      expect(isExecutionTool(name)).toBe(true)
      expect(isSkillTool(name)).toBe(false)
    }
  })

  it('lists execution attachments without leaking storage paths to the model', async () => {
    const result = await executeExecutionTool({
      toolName: 'list_spreadsheet_attachments',
      args: {},
      workspaceId: 'workspace-1',
      attachments: [{
        attachmentId: 'att-1',
        name: 'mevcut-durum.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        storageBucket: 'assistant-files',
        storagePath: 'user-1/workspace-1/inputs/att-1/mevcut-durum.xlsx',
      }],
      invoke: async () => {
        throw new Error('list must not invoke the workbook worker')
      },
    })

    expect(result.artifacts).toEqual([])
    expect(result.summary).toMatchObject({ executionOnly: true, citationReady: false, resultCount: 1 })
    expect(result.output).toContain('mevcut-durum.xlsx')
    expect(result.output).toContain('att-1')
    expect(result.output).not.toContain('user-1/workspace-1')
    expect(resultHasVerifiedKnowledgeEvidence({
      output: result.output,
      sources: [],
      summary: result.summary,
    })).toBe(false)
  })

  it('routes XLSX attachments to execution before legacy text attachment parsing', () => {
    expect(chatPanelSource).toContain("? 'tool_input'")
    expect(chatPanelSource).toContain('isSpreadsheetToolAttachment')
    expect(useMessagesSource).toContain('attachments: preparedAttachments,')
    expect(useMessagesSource).toContain("attachment.purpose === 'knowledge_bank'")
    expect(assistantRuntimeClientSource).toContain("candidate.purpose === 'chat_only'")
    expect(assistantRuntimeClientSource).toContain('!isSpreadsheetExecutionAttachment(candidate)')
    expect(assistantRuntimeClientSource).toContain("import { isSpreadsheetExecutionAttachment } from './assistantFileRepository';")
  })

  it('wires execution through the authenticated assistant dispatcher and private worker', () => {
    expect(assistantToolsSource).toContain("import { isExecutionTool } from './executionTools.ts'")
    expect(assistantToolsSource).toContain('executeSpreadsheetAssistantTool')
    expect(assistantToolsSource).toContain('if (isExecutionTool(toolName))')
    expect(messageRepositorySource).toContain('originalAttachments.splice')
    expect(messageRepositorySource).toContain('persistAssistantToolAttachments')

    expect(workerSource).toContain("npm:@office-kit/xlsx@0.9.0/io")
    expect(workerSource).toContain("npm:@office-kit/xlsx@0.9.0/worksheet")
    expect(workerSource).toContain("storageBucket !== ASSISTANT_FILES_BUCKET")
    expect(workerSource).toContain('loadWorkbook(fromArrayBuffer(outputBytes))')
    expect(workerSource).toContain('sheetStructurePreserved: true')
    expect(workerSource).toContain('writtenCellsVerified: plan.updates.length')
    expect(workerSource).toContain('.createSignedUrl(outputPath, ARTIFACT_LINK_TTL_SECONDS')
    expect(workerSource).not.toMatch(/\beval\s*\(/u)
    expect(workerSource).not.toContain('new Function(')
  })

  it('keeps assistant file storage private, workspace scoped and permanent-user only', () => {
    expect(migrationSource).toContain("'assistant-files'")
    expect(migrationSource).toContain('false,')
    expect(migrationSource).toContain('(storage.foldername(name))[1] = (select auth.uid())::text')
    expect(migrationSource).toContain('public.is_workspace_member((storage.foldername(name))[2])')
    expect(hardeningMigrationSource).toContain('as restrictive')
    expect(hardeningMigrationSource).toContain("auth.jwt()->>'is_anonymous'")
    expect(hardeningMigrationSource).toContain("bucket_id <> 'assistant-files'")
  })
})