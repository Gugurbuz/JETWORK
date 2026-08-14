from pathlib import Path

files = {
    'transform': Path('supabase/functions/_shared/spreadsheetTransform.ts'),
    'worker': Path('supabase/functions/spreadsheet-execute/index.ts'),
    'execution': Path('supabase/functions/_shared/executionTools.ts'),
    'assistant_tools': Path('supabase/functions/_shared/assistantTools.ts'),
    'spreadsheet_tool': Path('supabase/functions/_shared/spreadsheetAssistantTool.ts'),
    'core': Path('supabase/functions/openai-assistant-core-v2/implementation.ts'),
    'runtime': Path('src/services/assistantRuntimeClient.ts'),
    'messages': Path('src/hooks/useMessages.ts'),
    'chat': Path('src/components/ChatPanel.tsx'),
}

content = {key: path.read_text() for key, path in files.items()}

def replace_once(key: str, old: str, new: str):
    count = content[key].count(old)
    if count != 1:
        raise SystemExit(f'{key} patch anchor mismatch ({count}): {old[:140]}')
    content[key] = content[key].replace(old, new, 1)

# 1) Deterministic status-column naming. Preserve an existing suitable status column;
# otherwise create the canonical JetWork output column "Durum".
replace_once('transform',
"""  targetStatusColumn: number
  targetStatusColumnCreated: boolean
  targetSprintColumn: number""",
"""  targetStatusColumn: number
  targetStatusColumnName: string
  targetStatusColumnCreated: boolean
  targetSprintColumn: number""")

replace_once('transform',
"""  const existingTargetStatusIndex = columnIndex(target.headers, config.targetStatusColumn)
  const existingTargetSprintIndex = columnIndex(target.headers, config.targetSprintColumn)
  let nextTargetColumnIndex = target.headers.length
  const targetStatusIndex = existingTargetStatusIndex >= 0 ? existingTargetStatusIndex : nextTargetColumnIndex++
  const targetSprintIndex = existingTargetSprintIndex >= 0 ? existingTargetSprintIndex : nextTargetColumnIndex++""",
"""  const requestedTargetStatusIndex = columnIndex(target.headers, config.targetStatusColumn)
  const standardTargetStatusIndex = ['Durum', 'Status', 'Statü', 'Statu', 'Tamamlanma']
    .map(name => columnIndex(target.headers, name))
    .find(index => index >= 0) ?? -1
  const existingTargetStatusIndex = requestedTargetStatusIndex >= 0
    ? requestedTargetStatusIndex
    : standardTargetStatusIndex
  const targetStatusColumnName = existingTargetStatusIndex >= 0
    ? target.headers[existingTargetStatusIndex]
    : 'Durum'
  const existingTargetSprintIndex = columnIndex(target.headers, config.targetSprintColumn)
  let nextTargetColumnIndex = target.headers.length
  const targetStatusIndex = existingTargetStatusIndex >= 0 ? existingTargetStatusIndex : nextTargetColumnIndex++
  const targetSprintIndex = existingTargetSprintIndex >= 0 ? existingTargetSprintIndex : nextTargetColumnIndex++""")

replace_once('transform',
"""  if (existingTargetStatusIndex < 0) warnings.push(`\"${config.targetStatusColumn}\" kolonu hedef dosyaya eklenecek.`)""",
"""  if (existingTargetStatusIndex < 0) warnings.push(`\"${targetStatusColumnName}\" kolonu hedef dosyaya eklenecek.`)""")

replace_once('transform',
"""    targetStatusColumn: targetStatusIndex + 1,
    targetStatusColumnCreated: existingTargetStatusIndex < 0,""",
"""    targetStatusColumn: targetStatusIndex + 1,
    targetStatusColumnName,
    targetStatusColumnCreated: existingTargetStatusIndex < 0,""")

replace_once('worker',
"""      setCell(targetSheet, targetTable.headerRow, plan.targetStatusColumn, targetStatusColumn, headerStyleId)""",
"""      setCell(targetSheet, targetTable.headerRow, plan.targetStatusColumn, plan.targetStatusColumnName, headerStyleId)""")

replace_once('worker',
"""        changedCells: plan.updates.length,
        targetSprintColumnCreated: plan.targetSprintColumnCreated,""",
"""        changedCells: plan.updates.length,
        targetStatusColumnName: plan.targetStatusColumnName,
        targetStatusColumnCreated: plan.targetStatusColumnCreated,
        targetSprintColumnCreated: plan.targetSprintColumnCreated,""")

# 2) Do not expose worker signed URLs to the model. Keep secure artifact refs out-of-band.
replace_once('execution',
"""    description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. When the user asks to update/sync attached spreadsheets, this is the required completion tool: first list attachments and inspect the files/sheets needed to infer the real column mappings, then call this tool before giving a final answer. Do not stop after inspection and do not claim files are missing after list returned records. Preserves existing workbook structure/styles where possible, writes completion status and latest sprint, validates the generated workbook, and returns a private signed output artifact link.',""",
"""    description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. When the user asks to update/sync attached spreadsheets, this is the required completion tool: first list attachments and inspect the files/sheets needed to infer the real column mappings, then call this tool before giving a final answer. Do not stop after inspection and do not claim files are missing after list returned records. If the target has no suitable status column, use Durum as targetStatusColumn. Preserves existing workbook structure/styles where possible, writes completion status and latest sprint, validates the generated workbook, and returns output artifact metadata for the JetWork file card.',""")

replace_once('execution',
"""    return {
      output: JSON.stringify({ securityNotice: EXECUTION_NOTICE, tool: input.toolName, result }),
      artifacts,
      summary: {""",
"""    const { artifact: _artifact, ...resultWithoutArtifact } = result
    const modelArtifact = artifact
      ? {
          attachmentId: clean(artifact.attachmentId, 200),
          name: clean(artifact.name || 'jetwork-output.xlsx', 240),
          mimeType: clean(artifact.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 160),
          byteSize: Number(artifact.byteSize || 0),
          sha256: clean(artifact.sha256, 128),
        }
      : null
    return {
      output: JSON.stringify({
        securityNotice: EXECUTION_NOTICE,
        tool: input.toolName,
        result: { ...resultWithoutArtifact, artifact: modelArtifact },
      }),
      artifacts,
      summary: {""")

# 3) Carry generated artifacts through the assistant tool contract.
replace_once('assistant_tools',
"""import { isExecutionTool } from './executionTools.ts'""",
"""import { isExecutionTool, type AssistantGeneratedFileRef } from './executionTools.ts'""")
replace_once('assistant_tools',
"""export interface AssistantToolExecution {
  output: string
  sources: AssistantSourceRef[]
  summary: Record<string, unknown>
}""",
"""export interface AssistantToolExecution {
  output: string
  sources: AssistantSourceRef[]
  summary: Record<string, unknown>
  artifacts?: AssistantGeneratedFileRef[]
}""")

replace_once('spreadsheet_tool',
"""  return {
    output: execution.output,
    sources: [],
    summary: {""",
"""  return {
    output: execution.output,
    sources: [],
    artifacts: execution.artifacts,
    summary: {""")

# 4) Core: collect generated file refs and emit them as a dedicated SSE event.
replace_once('core',
"""      const toolResultCache = new Map<string, AssistantToolExecution>()
      const skillToolResultCache = new Map<string, SkillToolExecution>()""",
"""      const toolResultCache = new Map<string, AssistantToolExecution>()
      const generatedArtifacts = new Map<string, NonNullable<AssistantToolExecution['artifacts']>[number]>()
      const captureGeneratedArtifacts = (result: AssistantToolExecution) => {
        for (const artifact of result.artifacts || []) {
          const key = artifact.attachmentId || artifact.storagePath
          if (key) generatedArtifacts.set(key, artifact)
        }
      }
      const skillToolResultCache = new Map<string, SkillToolExecution>()""")

replace_once('core',
"""      const emitStatus = (stage: string, label: string) => {
        trace.push({ stage, label, at: new Date().toISOString() })
        if (trace.length > 24) trace.shift()
        sendEvent(controller, encoder, 'status', { type: 'status', stage, label })
      }

      const runKnowledgeTool""",
"""      const emitStatus = (stage: string, label: string) => {
        trace.push({ stage, label, at: new Date().toISOString() })
        if (trace.length > 24) trace.shift()
        sendEvent(controller, encoder, 'status', { type: 'status', stage, label })
      }
      const emitGeneratedArtifacts = () => {
        const artifacts = [...generatedArtifacts.values()].map(artifact => ({
          attachmentId: artifact.attachmentId,
          name: artifact.name,
          mimeType: artifact.mimeType,
          storageBucket: artifact.storageBucket,
          storagePath: artifact.storagePath,
          purpose: 'tool_output',
        }))
        if (artifacts.length) sendEvent(controller, encoder, 'artifacts', { type: 'artifacts', artifacts })
      }

      const runKnowledgeTool""")

replace_once('core',
"""          const result = await withTimeout(executeAssistantTool(client, workspaceId, toolName, args), TOOL_TIMEOUT_MS, toolName)
          toolResultCache.set(cacheKey, result)
          const verifiedKnowledgeEvidence""",
"""          const result = await withTimeout(executeAssistantTool(client, workspaceId, toolName, args), TOOL_TIMEOUT_MS, toolName)
          toolResultCache.set(cacheKey, result)
          captureGeneratedArtifacts(result)
          const verifiedKnowledgeEvidence""")

replace_once('core',
"""          spreadsheetSyncRequested
            ? 'SPREADSHEET EXECUTION CONTRACT: Kullanıcı ekli XLSX dosyalarını Jira export ile eşleştirip güncellemeni istiyor. list_spreadsheet_attachments sonucu kayıt döndürdüyse dosyalar mevcuttur; asla dosyaların ekli olmadığını söyleme. Gerekli dosyaları inspect ettikten ve kolon adlarını gözledikten sonra sync_spreadsheet_with_jira_export aracını çağırmadan nihai yanıt üretme. Kolon eşlemelerini inspect sonucundan çıkar; yalnız zorunlu kolon gerçekten yoksa kullanıcıdan netleştirme iste.'
            : '',""",
"""          spreadsheetSyncRequested
            ? 'SPREADSHEET EXECUTION CONTRACT: Kullanıcı ekli XLSX dosyalarını Jira export ile eşleştirip güncellemeni istiyor. list_spreadsheet_attachments sonucu kayıt döndürdüyse dosyalar mevcuttur; asla dosyaların ekli olmadığını söyleme. Gerekli dosyaları inspect ettikten ve kolon adlarını gözledikten sonra sync_spreadsheet_with_jira_export aracını çağırmadan nihai yanıt üretme. Kolon eşlemelerini inspect sonucundan çıkar. Hedefte uygun bir durum/status kolonu yoksa targetStatusColumn için standart olarak Durum kullan. Üretilen dosyanın signed URL veya storage path bilgisini nihai yanıta yazma; JetWork dosya kartını ayrıca gösterecek. Yalnız zorunlu kaynak kolonu gerçekten yoksa kullanıcıdan netleştirme iste.'
            : '',""")

# There are two successful completion paths that can produce a visible final response.
replace_once('core',
"""            sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: deterministicText })
            sendEvent(controller, encoder, 'sources', { type: 'sources', sources })""",
"""            emitGeneratedArtifacts()
            sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: deterministicText })
            sendEvent(controller, encoder, 'sources', { type: 'sources', sources })""")

replace_once('core',
"""            sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: roundText })
            sendEvent(controller, encoder, 'sources', { type: 'sources', sources })""",
"""            emitGeneratedArtifacts()
            sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: roundText })
            sendEvent(controller, encoder, 'sources', { type: 'sources', sources })""")

# 5) Browser runtime: parse artifact SSE events and return persisted MessageAttachments.
replace_once('runtime',
"""  | { type: 'sources'; sources: AssistantKnowledgeSource[] }
  | { type: 'status'; stage: AssistantRuntimeStage; label?: string }""",
"""  | { type: 'sources'; sources: AssistantKnowledgeSource[] }
  | { type: 'artifacts'; attachments: MessageAttachment[] }
  | { type: 'status'; stage: AssistantRuntimeStage; label?: string }""")

replace_once('runtime',
"""  usage?: Record<string, number>;
  workSummary?: string;""",
"""  usage?: Record<string, number>;
  attachments?: MessageAttachment[];
  workSummary?: string;""")

replace_once('runtime',
"""function documentStageLabel(""",
"""function asToolOutputAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): MessageAttachment | null => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Record<string, unknown>;
      const attachmentId = String(candidate.attachmentId || '').trim();
      const name = String(candidate.name || '').trim();
      const mimeType = String(candidate.mimeType || '').trim();
      const storageBucket = String(candidate.storageBucket || '').trim();
      const storagePath = String(candidate.storagePath || '').trim();
      if (!attachmentId || !name || !storagePath || storageBucket !== 'assistant-files') return null;
      if (!/\.xlsx$/i.test(name) && mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return null;
      if (!storagePath.includes('/outputs/')) return null;
      return {
        attachmentId,
        name,
        mimeType: mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        purpose: 'tool_output',
        storageBucket,
        storagePath,
        url: '',
      };
    })
    .filter((item): item is MessageAttachment => !!item);
}

function documentStageLabel(""")

replace_once('runtime',
"""  if (eventType === 'sources') {
    return { type: 'sources', sources: asKnowledgeSources(payload.sources) };
  }
  if (eventType === 'status') {""",
"""  if (eventType === 'sources') {
    return { type: 'sources', sources: asKnowledgeSources(payload.sources) };
  }
  if (eventType === 'artifacts') {
    return { type: 'artifacts', attachments: asToolOutputAttachments(payload.artifacts) };
  }
  if (eventType === 'status') {""")

replace_once('runtime',
"""  onSources?: (sources: AssistantKnowledgeSource[]) => void;
  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;""",
"""  onSources?: (sources: AssistantKnowledgeSource[]) => void;
  onArtifacts?: (attachments: MessageAttachment[]) => void;
  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;""")

replace_once('runtime',
"""  let sources: AssistantKnowledgeSource[] = [];
  let conversationId: string | undefined;""",
"""  let sources: AssistantKnowledgeSource[] = [];
  let attachments: MessageAttachment[] = [];
  let conversationId: string | undefined;""")

replace_once('runtime',
"""      if (parsed.type === 'sources') {
        sources = parsed.sources;
        input.onSources?.(sources);
        return;
      }
      if (parsed.type === 'status') {""",
"""      if (parsed.type === 'sources') {
        sources = parsed.sources;
        input.onSources?.(sources);
        return;
      }
      if (parsed.type === 'artifacts') {
        attachments = parsed.attachments;
        input.onArtifacts?.(attachments);
        return;
      }
      if (parsed.type === 'status') {""")

replace_once('runtime',
"""      usage,
      workSummary: runtimeWorkSummary || presentation.workSummary,""",
"""      usage,
      attachments,
      workSummary: runtimeWorkSummary || presentation.workSummary,""")

# 6) React message flow: keep artifact cards in optimistic/final UI and persist them on the AI message.
replace_once('messages',
"""      let streamedGroundingUrls: Message['groundingUrls'] = [];
      const stageNotes: string[] = [];""",
"""      let streamedGroundingUrls: Message['groundingUrls'] = [];
      let streamedAttachments: Message['attachments'] = [];
      const stageNotes: string[] = [];""")

replace_once('messages',
"""          onSources: sources => {
            const sourceView = splitAssistantSources(sources);""",
"""          onArtifacts: attachments => {
            streamedAttachments = attachments;
            setMessages(previous => previous.map(message => (
              message.id === aiMsgId ? { ...message, attachments } : message
            )));
            broadcastMessage(channelRef, 'ai_stream_chunk', {
              id: aiMsgId,
              text: streamedText,
              attachments,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
            });
          },
          onSources: sources => {
            const sourceView = splitAssistantSources(sources);""")

replace_once('messages',
"""          groundingUrls: finalSourceView.groundingUrls,
          tokenCount: result.usage?.total_tokens || result.usage?.totalTokens,""",
"""          groundingUrls: finalSourceView.groundingUrls,
          attachments: result.attachments?.length ? result.attachments : streamedAttachments,
          tokenCount: result.usage?.total_tokens || result.usage?.totalTokens,""")

# 7) UI: generated XLSX is a real downloadable file card, not a raw Markdown signed URL.
replace_once('chat',
"""CloudOff, Loader2 } from 'lucide-react';""",
"""CloudOff, Loader2, Download } from 'lucide-react';""")
replace_once('chat',
"""import { splitAssistantSources } from '../services/assistantSources';""",
"""import { splitAssistantSources } from '../services/assistantSources';
import { createAssistantFileDownloadUrl } from '../services/assistantFileRepository';
import { toast } from 'sonner';""")

replace_once('chat',
"""  const isWorkOnly = msg.role === 'model' && Boolean(msg.isTyping) && !msg.text;

  return (""",
"""  const isWorkOnly = msg.role === 'model' && Boolean(msg.isTyping) && !msg.text;
  const downloadToolOutput = async (attachment: MessageAttachment) => {
    try {
      const url = attachment.url || await createAssistantFileDownloadUrl(attachment);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name || 'jetwork-output.xlsx';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('Generated file download failed:', error);
      toast.error('Dosya indirme bağlantısı oluşturulamadı. Lütfen tekrar deneyin.');
    }
  };

  return (""")

replace_once('chat',
"""                  {msg.attachments.map((att, idx) => (
                    att.mimeType.startsWith('image/') ? (
                      <img key={idx} src={att.url} alt="uploaded" className="max-w-[200px] max-h-[200px] object-cover border border-theme-border/50 rounded-md shadow-sm" />
                    ) : (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-theme-surface border border-theme-border/50 rounded-md shadow-sm overflow-hidden max-w-[240px]">
                        <FileText size={16} className="text-theme-primary shrink-0" />
                        <span className="text-xs font-bold text-theme-text-muted uppercase shrink-0">{att.name?.split('.').pop() || 'FILE'}</span>
                        <div className="min-w-0">
                          {att.name && <div className="text-xs text-theme-text truncate">{att.name}</div>}
                          {ingestionLabel(att) && (
                            <div className={cn(
                              'mt-0.5 text-[10px] font-medium',
                              att.ingestion?.status === 'failed'
                                ? 'text-red-500'
                                : att.ingestion?.status === 'ready'
                                  ? 'text-emerald-600'
                                  : 'text-theme-primary',
                            )}>
                              {ingestionLabel(att)}
                              {att.ingestion?.status === 'ready' && att.ingestion.objectCount !== undefined
                                ? ` · ${att.ingestion.objectCount} nesne`
                                : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ))}""",
"""                  {msg.attachments.map((att, idx) => (
                    att.mimeType.startsWith('image/') ? (
                      <img key={idx} src={att.url} alt="uploaded" className="max-w-[200px] max-h-[200px] object-cover border border-theme-border/50 rounded-md shadow-sm" />
                    ) : att.purpose === 'tool_output' && att.storagePath ? (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void downloadToolOutput(att)}
                        className="group/file flex max-w-[320px] items-center gap-2 overflow-hidden rounded-lg border border-theme-primary/25 bg-theme-surface p-2.5 text-left shadow-sm transition-colors hover:border-theme-primary/60 hover:bg-theme-primary/5"
                        title={`${att.name || 'XLSX çıktı'} dosyasını indir`}
                      >
                        <FileText size={18} className="shrink-0 text-theme-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-theme-primary">XLSX Çıktısı</div>
                          <div className="truncate text-xs font-medium text-theme-text">{att.name || 'jetwork-output.xlsx'}</div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-theme-text-muted group-hover/file:text-theme-primary">
                          <Download size={13} /> İndir
                        </span>
                      </button>
                    ) : (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-theme-surface border border-theme-border/50 rounded-md shadow-sm overflow-hidden max-w-[240px]">
                        <FileText size={16} className="text-theme-primary shrink-0" />
                        <span className="text-xs font-bold text-theme-text-muted uppercase shrink-0">{att.name?.split('.').pop() || 'FILE'}</span>
                        <div className="min-w-0">
                          {att.name && <div className="text-xs text-theme-text truncate">{att.name}</div>}
                          {ingestionLabel(att) && (
                            <div className={cn(
                              'mt-0.5 text-[10px] font-medium',
                              att.ingestion?.status === 'failed'
                                ? 'text-red-500'
                                : att.ingestion?.status === 'ready'
                                  ? 'text-emerald-600'
                                  : 'text-theme-primary',
                            )}>
                              {ingestionLabel(att)}
                              {att.ingestion?.status === 'ready' && att.ingestion.objectCount !== undefined
                                ? ` · ${att.ingestion.objectCount} nesne`
                                : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ))}""")

for key, path in files.items():
    path.write_text(content[key])

# Regression coverage for both remaining production gaps.
test_path = Path('src/services/__tests__/spreadsheetOutputArtifactDelivery.test.ts')
test_path.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\nimport { executeExecutionTool } from '../../../supabase/functions/_shared/executionTools.ts'\nimport { planSpreadsheetJiraSync } from '../../../supabase/functions/_shared/spreadsheetTransform.ts'\n\nconst XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'\nconst coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')\nconst runtimeSource = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8')\nconst messageHookSource = readFileSync(new URL('../../hooks/useMessages.ts', import.meta.url), 'utf8')\nconst chatSource = readFileSync(new URL('../../components/ChatPanel.tsx', import.meta.url), 'utf8')\nconst spreadsheetToolSource = readFileSync(new URL('../../../supabase/functions/_shared/spreadsheetAssistantTool.ts', import.meta.url), 'utf8')\nconst workerSource = readFileSync(new URL('../../../supabase/functions/spreadsheet-execute/index.ts', import.meta.url), 'utf8')\n\ndescribe('Spreadsheet output artifact delivery', () => {\n  it('uses canonical Durum when the model proposes a new arbitrary status column', () => {\n    const plan = planSpreadsheetJiraSync(\n      { headerRow: 1, headers: ['JIRA', 'Story'], rows: [['ABC-1', 'Test']] },\n      { headerRow: 1, headers: ['JIRA No', 'Status', 'Sprint'], rows: [['ABC-1', 'Done', 'EN-Fast Sprint 105']] },\n      {\n        targetKeyColumn: 'JIRA', jiraKeyColumn: 'JIRA No', jiraStatusColumn: 'Status',\n        targetStatusColumn: 'Tamamlanma', doneStatuses: ['Done', 'Closed'], completedValue: 'tamamlandı',\n        jiraSprintColumn: 'Sprint', targetSprintColumn: 'Enfast Sprint', sprintNamePattern: 'EN-Fast',\n      },\n    )\n    expect(plan.targetStatusColumnCreated).toBe(true)\n    expect(plan.targetStatusColumnName).toBe('Durum')\n    expect(workerSource).toContain('plan.targetStatusColumnName')\n  })\n\n  it('keeps storage refs out of model-visible tool output while retaining the generated artifact', async () => {\n    const result = await executeExecutionTool({\n      toolName: 'sync_spreadsheet_with_jira_export',\n      workspaceId: 'workspace-1',\n      attachments: [\n        { attachmentId: 'target-1', name: 'target.xlsx', mimeType: XLSX, storageBucket: 'assistant-files', storagePath: 'user/workspace-1/inputs/target-1/target.xlsx' },\n        { attachmentId: 'jira-1', name: 'jira.xlsx', mimeType: XLSX, storageBucket: 'assistant-files', storagePath: 'user/workspace-1/inputs/jira-1/jira.xlsx' },\n      ],\n      args: {\n        targetAttachmentId: 'target-1', jiraAttachmentId: 'jira-1', targetSheetName: 'BACKLOG', jiraSheetName: 'JIRA_TAM_LISTE',\n        targetKeyColumn: 'JIRA', jiraKeyColumn: 'JIRA No', jiraStatusColumn: 'Status', targetStatusColumn: 'Durum',\n        doneStatuses: ['Done', 'Closed'], completedValue: 'tamamlandı', jiraSprintColumn: 'Sprint',\n        targetSprintColumn: 'Enfast Sprint', sprintNamePattern: 'EN-Fast', outputFileName: 'result.xlsx',\n      },\n      invoke: async () => ({\n        artifact: {\n          attachmentId: 'output-1', name: 'result.xlsx', mimeType: XLSX, storageBucket: 'assistant-files',\n          storagePath: 'user/workspace-1/outputs/output-1/result.xlsx',\n          downloadUrl: 'https://example.invalid/private-signed-url', downloadUrlExpiresInSeconds: 604800, byteSize: 1234, sha256: 'abc',\n        },\n        summary: { matchedRows: 1 },\n      }),\n    })\n\n    expect(result.artifacts).toHaveLength(1)\n    expect(result.artifacts[0].storagePath).toContain('/outputs/')\n    expect(result.output).not.toContain('private-signed-url')\n    expect(result.output).not.toContain('/outputs/output-1/')\n  })\n\n  it('wires artifact refs from core SSE through persistence and a secure download card', () => {\n    expect(spreadsheetToolSource).toContain('artifacts: execution.artifacts')\n    expect(coreSource).toContain('const generatedArtifacts = new Map')\n    expect(coreSource).toContain("sendEvent(controller, encoder, 'artifacts'")\n    expect(runtimeSource).toContain("eventType === 'artifacts'")\n    expect(runtimeSource).toContain("purpose: 'tool_output'")\n    expect(messageHookSource).toContain('attachments: result.attachments?.length ? result.attachments : streamedAttachments')\n    expect(chatSource).toContain('createAssistantFileDownloadUrl')\n    expect(chatSource).toContain("att.purpose === 'tool_output'")\n  })\n})\n""")
