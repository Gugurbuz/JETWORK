from pathlib import Path


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    found = text.count(old)
    if found != count:
        raise SystemExit(f"{path}: expected {count} matches, found {found}")
    file.write_text(text.replace(old, new))


# Binary action attachments must never fall back to legacy text parsing.
replace_exact(
    'src/services/assistantRuntimeClient.ts',
    "import { isSpreadsheetExecutionAttachment } from './assistantFileRepository';",
    "import { isActionableExecutionAttachment } from './assistantFileRepository';",
)
replace_exact(
    'src/services/assistantRuntimeClient.ts',
    "    && !isSpreadsheetExecutionAttachment(candidate)\n",
    "    && !isActionableExecutionAttachment(candidate)\n",
)

# Attachment-only acknowledgement applies to every supported action file, not only XLSX.
proxy = 'supabase/functions/openai-assistant-live-proxy/index.ts'
replace_exact(
    proxy,
    '''const isSpreadsheetToolInput = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Record<string, unknown>
  const name = cleanString(attachment.name, 240)
  const mimeType = cleanString(attachment.mimeType, 160)
  return cleanString(attachment.purpose, 40) === 'tool_input'
    && cleanString(attachment.storageBucket, 120) === 'assistant-files'
    && !!cleanString(attachment.storagePath, 1_000)
    && (/\\.xlsx$/i.test(name) || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

const attachmentOnlySpreadsheetResponse = (messageId: string) => new Response(
''',
    '''const isActionToolInput = (value: unknown) => {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Record<string, unknown>
  return cleanString(attachment.purpose, 40) === 'tool_input'
    && cleanString(attachment.storageBucket, 120) === 'assistant-files'
    && !!cleanString(attachment.storagePath, 1_000)
}

const attachmentOnlyActionResponse = (messageId: string) => new Response(
''',
)
replace_exact(proxy, 'attachments.some(isSpreadsheetToolInput)', 'attachments.some(isActionToolInput)')
replace_exact(proxy, 'return attachmentOnlySpreadsheetResponse(messageId)', 'return attachmentOnlyActionResponse(messageId)')

# Generated artifacts of every MIME type use the secure file-card path.
chat = 'src/components/ChatPanel.tsx'
replace_exact(
    chat,
    '''                  {msg.attachments.map((att, idx) => (
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
''',
    '''                  {msg.attachments.map((att, idx) => (
                    att.purpose === 'tool_output' && att.storagePath ? (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => void downloadToolOutput(att)}
                        className="group/file flex max-w-[340px] items-center gap-2 overflow-hidden rounded-lg border border-theme-primary/25 bg-theme-surface p-2.5 text-left shadow-sm transition-colors hover:border-theme-primary/60 hover:bg-theme-primary/5"
                        title={`${att.name || 'JetWork çıktısı'} dosyasını indir`}
                      >
                        <FileText size={18} className="shrink-0 text-theme-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-theme-primary">{(att.name?.split('.').pop() || 'FILE').toUpperCase()} Çıktısı</div>
                          <div className="truncate text-xs font-medium text-theme-text">{att.name || 'jetwork-output'}</div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-theme-text-muted group-hover/file:text-theme-primary">
                          <Download size={13} /> İndir
                        </span>
                      </button>
                    ) : att.mimeType.startsWith('image/') ? (
                      <img key={idx} src={att.url} alt="uploaded" className="max-w-[200px] max-h-[200px] object-cover border border-theme-border/50 rounded-md shadow-sm" />
                    ) : (
''',
)
