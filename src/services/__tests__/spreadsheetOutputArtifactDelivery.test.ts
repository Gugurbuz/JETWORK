import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { executeExecutionTool } from '../../../supabase/functions/_shared/executionTools.ts'
import { planSpreadsheetJiraSync } from '../../../supabase/functions/_shared/spreadsheetTransform.ts'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8')
const messageHookSource = readFileSync(new URL('../../hooks/useMessages.ts', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../../components/ChatPanel.tsx', import.meta.url), 'utf8')
const spreadsheetToolSource = readFileSync(new URL('../../../supabase/functions/_shared/spreadsheetAssistantTool.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url), 'utf8')

describe('Spreadsheet output artifact delivery', () => {
  it('uses canonical Durum when the model proposes a new arbitrary status column', () => {
    const plan = planSpreadsheetJiraSync(
      { headerRow: 1, headers: ['JIRA', 'Story'], rows: [['ABC-1', 'Test']] },
      { headerRow: 1, headers: ['JIRA No', 'Status', 'Sprint'], rows: [['ABC-1', 'Done', 'EN-Fast Sprint 105']] },
      {
        targetKeyColumn: 'JIRA', jiraKeyColumn: 'JIRA No', jiraStatusColumn: 'Status',
        targetStatusColumn: 'Tamamlanma', doneStatuses: ['Done', 'Closed'], completedValue: 'tamamlandı',
        jiraSprintColumn: 'Sprint', targetSprintColumn: 'Enfast Sprint', sprintNamePattern: 'EN-Fast',
      },
    )
    expect(plan.targetStatusColumnCreated).toBe(true)
    expect(plan.targetStatusColumnName).toBe('Durum')
    expect(workerSource).toContain('plan.targetStatusColumnName')
  })

  it('keeps storage refs out of model-visible tool output while retaining the generated artifact', async () => {
    const result = await executeExecutionTool({
      toolName: 'sync_spreadsheet_with_jira_export',
      workspaceId: 'workspace-1',
      attachments: [
        { attachmentId: 'target-1', name: 'target.xlsx', mimeType: XLSX, storageBucket: 'assistant-files', storagePath: 'user/workspace-1/inputs/target-1/target.xlsx' },
        { attachmentId: 'jira-1', name: 'jira.xlsx', mimeType: XLSX, storageBucket: 'assistant-files', storagePath: 'user/workspace-1/inputs/jira-1/jira.xlsx' },
      ],
      args: {
        targetAttachmentId: 'target-1', jiraAttachmentId: 'jira-1', targetSheetName: 'BACKLOG', jiraSheetName: 'JIRA_TAM_LISTE',
        targetKeyColumn: 'JIRA', jiraKeyColumn: 'JIRA No', jiraStatusColumn: 'Status', targetStatusColumn: 'Durum',
        doneStatuses: ['Done', 'Closed'], completedValue: 'tamamlandı', jiraSprintColumn: 'Sprint',
        targetSprintColumn: 'Enfast Sprint', sprintNamePattern: 'EN-Fast', outputFileName: 'result.xlsx',
      },
      invoke: async () => ({
        artifact: {
          attachmentId: 'output-1', name: 'result.xlsx', mimeType: XLSX, storageBucket: 'assistant-files',
          storagePath: 'user/workspace-1/outputs/output-1/result.xlsx',
          downloadUrl: 'https://example.invalid/private-signed-url', downloadUrlExpiresInSeconds: 604800, byteSize: 1234, sha256: 'abc',
        },
        summary: { matchedRows: 1 },
      }),
    })

    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0].storagePath).toContain('/outputs/')
    expect(result.output).not.toContain('private-signed-url')
    expect(result.output).not.toContain('/outputs/output-1/')
  })

  it('wires artifact refs from core SSE through persistence and a secure download card', () => {
    expect(spreadsheetToolSource).toContain('artifacts: execution.artifacts')
    expect(coreSource).toContain('const generatedArtifacts = new Map')
    expect(coreSource).toContain("sendEvent(controller, encoder, 'artifacts'")
    expect(runtimeSource).toContain("eventType === 'artifacts'")
    expect(runtimeSource).toContain("purpose: 'tool_output'")
    expect(messageHookSource).toContain('attachments: result.attachments?.length ? result.attachments : streamedAttachments')
    expect(chatSource).toContain('createAssistantFileDownloadUrl')
    expect(chatSource).toContain("att.purpose === 'tool_output'")
  })
})
