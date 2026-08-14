from pathlib import Path


def replace_exact(path: str, old: str, new: str, count: int = 1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} occurrence(s), found {actual}')
    p.write_text(text.replace(old, new, count))


# XLSX is an execution input by default, not a legacy text chat attachment.
replace_exact(
    'src/components/ChatPanel.tsx',
    "const defaultAttachmentPurpose = (): MessageAttachment['purpose'] => 'chat_only';",
    """const isSpreadsheetToolAttachment = (attachment: Pick<MessageAttachment, 'name' | 'mimeType'>): boolean => (
  /\\.xlsx$/i.test(attachment.name || '')
  || attachment.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

const defaultAttachmentPurpose = (
  attachment: Pick<MessageAttachment, 'name' | 'mimeType'>,
): MessageAttachment['purpose'] => (
  FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && isSpreadsheetToolAttachment(attachment)
    ? 'tool_input'
    : 'chat_only'
);""",
)
replace_exact(
    'src/components/ChatPanel.tsx',
    'purpose: defaultAttachmentPurpose(),',
    "purpose: defaultAttachmentPurpose({ name: file.name, mimeType: file.type }),",
    count=2,
)
replace_exact(
    'src/components/ChatPanel.tsx',
    """      target?.purpose === 'knowledge_bank'
      && selectedAttachments.filter(attachment => attachment.purpose === 'chat_only').length
        >= MAX_CHAT_ATTACHMENTS""",
    """      target?.purpose === 'knowledge_bank'
      && !isSpreadsheetToolAttachment(target)
      && selectedAttachments.filter(attachment => attachment.purpose === 'chat_only').length
        >= MAX_CHAT_ATTACHMENTS""",
)
replace_exact(
    'src/components/ChatPanel.tsx',
    "purpose: attachment.purpose === 'knowledge_bank' ? 'chat_only' : 'knowledge_bank',",
    """purpose: attachment.purpose === 'knowledge_bank'
              ? (isSpreadsheetToolAttachment(attachment) ? 'tool_input' : 'chat_only')
              : 'knowledge_bank',""",
)

# Persistence and runtime must share the same attachment array so storage refs propagate.
replace_exact(
    'src/hooks/useMessages.ts',
    """    const preparedAttachments = attachments?.map(attachment => ({
      ...attachment,
      attachmentId: attachment.attachmentId || crypto.randomUUID(),
    }));""",
    """    const preparedAttachments = attachments?.map(attachment => ({
      ...attachment,
      attachmentId: attachment.attachmentId || crypto.randomUUID(),
      ingestion: attachment.purpose === 'knowledge_bank'
        ? { status: 'queued' as const }
        : attachment.ingestion,
    }));""",
)
replace_exact(
    'src/hooks/useMessages.ts',
    """      attachments: preparedAttachments?.map(a => ({
        attachmentId: a.attachmentId,
        url: a.url,
        data: a.data,
        name: a.name,
        mimeType: a.mimeType,
        purpose: a.purpose,
        ingestion: a.purpose === 'knowledge_bank'
          ? { status: 'queued' }
          : undefined,
      })),""",
    '      attachments: preparedAttachments,',
)

# Defensive compatibility for stale messages: XLSX never enters UTF-8 text extraction.
replace_exact(
    'src/services/assistantRuntimeClient.ts',
    "import { useDocumentStore } from '../store/useDocumentStore';",
    """import { useDocumentStore } from '../store/useDocumentStore';
import { isSpreadsheetExecutionAttachment } from './assistantFileRepository';""",
)
replace_exact(
    'src/services/assistantRuntimeClient.ts',
    "const chatAttachments = attachments.filter(candidate => candidate.purpose === 'chat_only');",
    """const chatAttachments = attachments.filter(candidate => (
    candidate.purpose === 'chat_only'
    && !isSpreadsheetExecutionAttachment(candidate)
  ));""",
)

# Static regression contract for the exact live failure path.
test_path = Path('src/services/__tests__/spreadsheetExecutionLayer.test.ts')
test = test_path.read_text()
marker = """const messageRepositorySource = readFileSync(
  new URL('../messageRepository.ts', import.meta.url),
  'utf8',
)
"""
if test.count(marker) != 1:
    raise SystemExit('spreadsheetExecutionLayer.test.ts: messageRepository marker drifted')
test = test.replace(marker, marker + """const chatPanelSource = readFileSync(
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
""", 1)
marker2 = """  it('wires execution through the authenticated assistant dispatcher and private worker', () => {
"""
if test.count(marker2) != 1:
    raise SystemExit('spreadsheetExecutionLayer.test.ts: execution marker drifted')
regression = """  it('routes XLSX attachments to execution before legacy text attachment parsing', () => {
    expect(chatPanelSource).toContain("? 'tool_input'")
    expect(chatPanelSource).toContain('isSpreadsheetToolAttachment')
    expect(useMessagesSource).toContain('attachments: preparedAttachments,')
    expect(useMessagesSource).toContain("attachment.purpose === 'knowledge_bank'")
    expect(assistantRuntimeClientSource).toContain("candidate.purpose === 'chat_only'")
    expect(assistantRuntimeClientSource).toContain('!isSpreadsheetExecutionAttachment(candidate)')
    expect(assistantRuntimeClientSource).toContain("import { isSpreadsheetExecutionAttachment } from './assistantFileRepository';")
  })

"""
test_path.write_text(test.replace(marker2, regression + marker2, 1))
