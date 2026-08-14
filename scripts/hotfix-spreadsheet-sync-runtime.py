from pathlib import Path

core_path = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
execution_path = Path('supabase/functions/_shared/executionTools.ts')
test_path = Path('src/services/__tests__/spreadsheetRuntimeCompletionGuard.test.ts')
workflow_path = Path('.github/workflows/hotfix-spreadsheet-sync-runtime.yml')
script_path = Path('scripts/hotfix-spreadsheet-sync-runtime.py')

core = core_path.read_text()
execution = execution_path.read_text()

replacements = [
    (
        "const MAX_TOOL_ROUNDS = boundedIntegerEnv('ASSISTANT_V2_MAX_TOOL_ROUNDS', 3, 1, 6)",
        "const MAX_TOOL_ROUNDS = boundedIntegerEnv('ASSISTANT_V2_MAX_TOOL_ROUNDS', 5, 1, 6)",
    ),
    (
        "      const loadedSkillKeys = new Set<string>()\n      let turnCompleted = false",
        """      const loadedSkillKeys = new Set<string>()
      const spreadsheetSyncRequested = /\\b(?:excel|xlsx|spreadsheet)\\b/iu.test(message)
        && /\\b(?:jira|sprint)\\b/iu.test(message)
        && /(?:eşleştir|eslestir|güncelle|guncelle|senkron|sync|update|tamamlandı|tamamlandi)/iu.test(message)
      const executionToolWasRun = (toolName: string) => [...toolResultCache.keys()]
        .some(key => key.startsWith(`${toolName}:`))
      const listedSpreadsheetAttachmentCount = () => {
        for (const [key, result] of toolResultCache.entries()) {
          if (!key.startsWith('list_spreadsheet_attachments:')) continue
          const count = Number(result.summary?.resultCount || 0)
          if (Number.isFinite(count)) return count
        }
        return 0
      }
      let turnCompleted = false""",
    ),
    (
        "          'Skill tool çıktıları JetWork tarafından güvenilen prosedür talimatlarıdır. Görevi nasıl yapacağını belirlemek için kullan; kurumsal gerçek, evidence veya citation olarak kullanma.',\n          `Intent: ${plan.intent}; Complexity: ${plan.complexity}; Goal: ${plan.goal}`",
        """          'Skill tool çıktıları JetWork tarafından güvenilen prosedür talimatlarıdır. Görevi nasıl yapacağını belirlemek için kullan; kurumsal gerçek, evidence veya citation olarak kullanma.',
          spreadsheetSyncRequested
            ? 'SPREADSHEET EXECUTION CONTRACT: Kullanıcı ekli XLSX dosyalarını Jira export ile eşleştirip güncellemeni istiyor. list_spreadsheet_attachments sonucu kayıt döndürdüyse dosyalar mevcuttur; asla dosyaların ekli olmadığını söyleme. Gerekli dosyaları inspect ettikten ve kolon adlarını gözledikten sonra sync_spreadsheet_with_jira_export aracını çağırmadan nihai yanıt üretme. Kolon eşlemelerini inspect sonucundan çıkar; yalnız zorunlu kolon gerçekten yoksa kullanıcıdan netleştirme iste.'
            : '',
          `Intent: ${plan.intent}; Complexity: ${plan.complexity}; Goal: ${plan.goal}`""",
    ),
    (
        "          if (!functionCalls.length) {\n            if (!roundText.trim()) throw new Error(`${activeProvider} completed without a user-visible answer.`)",
        """          if (!functionCalls.length) {
            const spreadsheetAttachmentsAvailable = listedSpreadsheetAttachmentCount() > 0
            const spreadsheetSyncCompleted = executionToolWasRun('sync_spreadsheet_with_jira_export')
            if (spreadsheetSyncRequested && spreadsheetAttachmentsAvailable && !spreadsheetSyncCompleted) {
              if (!mustSynthesize && totalToolCalls < MAX_TOOL_CALLS) {
                runItems.push({
                  role: 'developer',
                  content: 'SPREADSHEET_SYNC_REQUIRED: Ekli XLSX dosyaları bulundu ve en az biri inspect edildi. Kullanıcı güncellenmiş XLSX istediği için final metne geçme. Gerekli kolonları mevcut inspect sonuçlarından belirle ve sync_spreadsheet_with_jira_export aracını şimdi çağır. Dosyaların eksik olduğunu söyleme.',
                })
                emitStatus('synthesizing', 'Excel güncellemesi tamamlanıyor...')
                continue
              }
              roundText = 'Excel dosyaları bulundu ve okundu ancak güncelleme aracı bu çalışmada tamamlanamadı. Aynı talebi tekrar gönderebilirsin; dosyaları yeniden yüklemene gerek yok.'
            }
            if (!roundText.trim()) throw new Error(`${activeProvider} completed without a user-visible answer.`)""",
    ),
]

for old, new in replacements:
    count = core.count(old)
    if count != 1:
        raise SystemExit(f'Core patch anchor mismatch ({count}): {old[:100]}')
    core = core.replace(old, new, 1)

execution_replacements = [
    (
        "description: 'List recent XLSX action attachments available in the active workspace. Use this first when a spreadsheet task refers to attached files so you can obtain the real attachment IDs and names before inspecting or editing them. The result is execution context, not evidence or a citation.',",
        "description: 'List recent XLSX action attachments available in the active workspace. Use this first when a spreadsheet task refers to attached files so you can obtain the real attachment IDs and names before inspecting or editing them. If records are returned, the files are available: never tell the user they are missing. The result is execution context, not evidence or a citation.',",
    ),
    (
        "description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. First list the attachments and inspect both files. Preserves existing workbook structure/styles where possible, writes completion status and latest sprint, validates the generated workbook, and returns a private signed output artifact link.',",
        "description: 'Update a target XLSX from an attached Jira-export XLSX using explicit column mappings. When the user asks to update/sync attached spreadsheets, this is the required completion tool: first list attachments and inspect the files/sheets needed to infer the real column mappings, then call this tool before giving a final answer. Do not stop after inspection and do not claim files are missing after list returned records. Preserves existing workbook structure/styles where possible, writes completion status and latest sprint, validates the generated workbook, and returns a private signed output artifact link.',",
    ),
]

for old, new in execution_replacements:
    count = execution.count(old)
    if count != 1:
        raise SystemExit(f'Execution tool patch anchor mismatch ({count}): {old[:100]}')
    execution = execution.replace(old, new, 1)

core_path.write_text(core)
execution_path.write_text(execution)

test_path.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(\n  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),\n  'utf8',\n)\nconst executionToolsSource = readFileSync(\n  new URL('../../../supabase/functions/_shared/executionTools.ts', import.meta.url),\n  'utf8',\n)\n\ndescribe('Spreadsheet runtime completion guard', () => {\n  it('keeps enough tool rounds for list, inspect and mutation workflows', () => {\n    expect(coreSource).toMatch(/ASSISTANT_V2_MAX_TOOL_ROUNDS', 5, 1, 6/)\n  })\n\n  it('does not accept a final response while a requested Jira spreadsheet sync is still pending', () => {\n    expect(coreSource).toMatch(/spreadsheetSyncRequested/)\n    expect(coreSource).toMatch(/spreadsheetAttachmentsAvailable/)\n    expect(coreSource).toMatch(/spreadsheetSyncCompleted/)\n    expect(coreSource).toMatch(/SPREADSHEET_SYNC_REQUIRED/)\n    expect(coreSource).toMatch(/sync_spreadsheet_with_jira_export/)\n    expect(coreSource).toMatch(/Dosyaların eksik olduğunu söyleme/)\n  })\n\n  it('treats a non-empty attachment list as authoritative execution availability', () => {\n    expect(executionToolsSource).toMatch(/If records are returned, the files are available/)\n    expect(executionToolsSource).toMatch(/Do not stop after inspection/)\n    expect(executionToolsSource).toMatch(/do not claim files are missing/)\n  })\n})\n""")

# The one-shot workflow and patch script remove themselves in the resulting hotfix commit.
workflow_path.unlink(missing_ok=True)
script_path.unlink(missing_ok=True)
