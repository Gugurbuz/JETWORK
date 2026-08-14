from pathlib import Path
import re


def replace_exact(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    found = text.count(old)
    if found != count:
        raise SystemExit(f"{path}: expected {count} matches, found {found}")
    file.write_text(text.replace(old, new))


execution = Path('supabase/functions/_shared/executionTools.ts')
text = execution.read_text()
text, n = re.subn(
    r"description: 'Apply allow-listed workbook edits to an attached XLSX[^\n]+',",
    "description: 'Apply allow-listed workbook edits to an attached XLSX and return a new XLSX artifact. Use for direct value, formula, fill color, bold, font size, merge, filter, freeze-pane and add-sheet edits such as \\\"tüm satırları kırmızıya boya\\\". Inspect first when the target sheet/range is not already known. set_fill uses value as a color name or hex; set_formula uses value as formula text; set_bold makes the target bold; set_font_size uses number; merge/filter/freeze use target; add_sheet uses value.',",
    text,
    count=1,
)
if n != 1:
    raise SystemExit(f'executionTools.ts: edit description replacement count {n}')
old_enum = "operation: { type: 'string', enum: ['set_value','set_formula','set_fill','set_bold','set_font_size','merge_cells','unmerge_cells','add_filter','freeze_panes','add_sheet','rename_sheet'] },"
new_enum = "operation: { type: 'string', enum: ['set_value','set_formula','set_fill','set_bold','set_font_size','merge_cells','add_filter','freeze_panes','add_sheet'] },"
if text.count(old_enum) != 1:
    raise SystemExit(f'executionTools.ts: enum expected 1, found {text.count(old_enum)}')
text = text.replace(old_enum, new_enum)
old_list = "description: 'List recent XLSX action attachments available in the active workspace. Use this first for spreadsheet tasks. If records are returned, the files are available: never tell the user they are missing. This result is execution context, not evidence.',"
new_list = "description: 'List recent XLSX action attachments available in the active workspace. Use this first for spreadsheet tasks. If records are returned, the files are available: never tell the user they are missing; do not claim files are missing. This result is execution context, not evidence.',"
if text.count(old_list) != 1:
    raise SystemExit(f'executionTools.ts: list description expected 1, found {text.count(old_list)}')
execution.write_text(text.replace(old_list, new_list))

core = 'supabase/functions/openai-assistant-core-v2/implementation.ts'
replace_exact(
    core,
    '''      const spreadsheetSyncRequested = /\\b(?:excel|xlsx|spreadsheet)\\b/iu.test(message)
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
''',
    '''      const spreadsheetSyncRequested = /\\b(?:excel|xlsx|spreadsheet)\\b/iu.test(message)
        && /\\b(?:jira|sprint)\\b/iu.test(message)
        && /(?:eşleştir|eslestir|güncelle|guncelle|senkron|sync|update|tamamlandı|tamamlandi)/iu.test(message)
      const spreadsheetCreateRequested = /\\b(?:excel|xlsx|spreadsheet)\\b/iu.test(message)
        && /(?:oluştur|olustur|hazırla|hazirla|üret|uret|create|generate)/iu.test(message)
        && !spreadsheetSyncRequested
      const spreadsheetMutationRequested = /\\b(?:excel|xlsx|spreadsheet|satır|satir|sütun|sutun|kolon|hücre|hucre)\\b/iu.test(message)
        && /(?:boya|renklendir|format|biçim|bicim|düzenle|duzenle|değiştir|degistir|yaz|ekle|sil|formül|formul|formula|filtre|sırala|sirala|sort|duplicate|tekilleştir|tekillestir|temizle|join|birleştir|birlestir|aggregate|özetle|ozetle)/iu.test(message)
        && !spreadsheetSyncRequested
        && !spreadsheetCreateRequested
      const pdfMutationRequested = /\\bpdf\\b/iu.test(message)
        && /(?:birleştir|birlestir|böl|bol|split|merge|düzenle|duzenle|oluştur|olustur|üret|uret)/iu.test(message)
      const officeMutationRequested = /\\b(?:word|docx|pptx|powerpoint|sunum|slayt)\\b/iu.test(message)
        && /(?:düzenle|duzenle|değiştir|degistir|ekle|oluştur|olustur|hazırla|hazirla|üret|uret|create|generate)/iu.test(message)
      const imageMutationRequested = /\\b(?:image|görsel|gorsel|resim|fotoğraf|fotograf|png|jpg|jpeg|webp)\\b/iu.test(message)
        && /(?:düzenle|duzenle|değiştir|degistir|oluştur|olustur|üret|uret|generate|edit|tasarla)/iu.test(message)
      const artifactMutationRequested = pdfMutationRequested || officeMutationRequested || imageMutationRequested
      const executionToolWasRun = (toolName: string) => [...toolResultCache.keys()]
        .some(key => key.startsWith(`${toolName}:`))
      const anyExecutionToolWasRun = (toolNames: string[]) => toolNames.some(executionToolWasRun)
      const listedSpreadsheetAttachmentCount = () => {
        for (const [key, result] of toolResultCache.entries()) {
          if (!key.startsWith('list_spreadsheet_attachments:')) continue
          const count = Number(result.summary?.resultCount || 0)
          if (Number.isFinite(count)) return count
        }
        return 0
      }
      const listedActionAttachmentCount = () => {
        for (const [key, result] of toolResultCache.entries()) {
          if (!key.startsWith('list_action_attachments:')) continue
          const count = Number(result.summary?.resultCount || 0)
          if (Number.isFinite(count)) return count
        }
        return 0
      }
''',
)
replace_exact(
    core,
    '''          spreadsheetSyncRequested
            ? 'SPREADSHEET EXECUTION CONTRACT: Kullanıcı ekli XLSX dosyalarını Jira export ile eşleştirip güncellemeni istiyor. list_spreadsheet_attachments sonucu kayıt döndürdüyse dosyalar mevcuttur; asla dosyaların ekli olmadığını söyleme. Gerekli dosyaları inspect ettikten ve kolon adlarını gözledikten sonra sync_spreadsheet_with_jira_export aracını çağırmadan nihai yanıt üretme. Kolon eşlemelerini inspect sonucundan çıkar. Hedefte uygun bir durum/status kolonu yoksa targetStatusColumn için standart olarak Durum kullan. Üretilen dosyanın signed URL veya storage path bilgisini nihai yanıta yazma; JetWork dosya kartını ayrıca gösterecek. Yalnız zorunlu kaynak kolonu gerçekten yoksa kullanıcıdan netleştirme iste.'
            : '',
''',
    '''          spreadsheetSyncRequested
            ? 'SPREADSHEET EXECUTION CONTRACT: Kullanıcı ekli XLSX dosyalarını Jira export ile eşleştirip güncellemeni istiyor. list_spreadsheet_attachments sonucu kayıt döndürdüyse dosyalar mevcuttur; asla dosyaların ekli olmadığını söyleme. Gerekli dosyaları inspect ettikten ve kolon adlarını gözledikten sonra sync_spreadsheet_with_jira_export aracını çağırmadan nihai yanıt üretme. Kolon eşlemelerini inspect sonucundan çıkar. Hedefte uygun bir durum/status kolonu yoksa targetStatusColumn için standart olarak Durum kullan. Üretilen dosyanın signed URL veya storage path bilgisini nihai yanıta yazma; JetWork dosya kartını ayrıca gösterecek. Yalnız zorunlu kaynak kolonu gerçekten yoksa kullanıcıdan netleştirme iste.'
            : '',
          spreadsheetMutationRequested
            ? 'GENERIC SPREADSHEET EDIT CONTRACT: Kullanıcı ekli Excel üzerinde gerçek bir değişiklik istiyor. list_spreadsheet_attachments ile gerçek attachment idlerini bul; sheet/range belirsizse inspect_spreadsheet_file ile yapıyı gözle. Biçim/hücre/formül/sheet değişikliği için edit_spreadsheet_file, sort/filter/deduplicate/clean/aggregate/join için transform_spreadsheet_file çağır. Executor tamamlanmadan Excel düzenleyemiyorum deme ve nihai yanıt üretme. Üretilen artifact UI dosya kartıyla teslim edilir; signed URL/storage path yazma.'
            : '',
          spreadsheetCreateRequested
            ? 'SPREADSHEET CREATE CONTRACT: Kullanıcı yeni Excel/XLSX istiyor. create_spreadsheet_file çağrısını tamamlamadan yalnız metin/tablo cevabıyla yetinme. Dosya artifactını UI kartıyla teslim et; signed URL/storage path yazma.'
            : '',
          artifactMutationRequested
            ? 'MULTI-FORMAT ARTIFACT CONTRACT: Kullanıcı PDF/Word/PPTX/Image üzerinde gerçek dosya üretimi veya düzenlemesi istiyor. Mevcut dosya gerekiyorsa list_action_attachments ve gerekirse inspect_file_attachment kullan. PDF merge/split için transform_pdf_file; DOCX/PPTX exact edit için edit_office_file; yeni DOCX/PPTX için create_document_file; image generate/edit için generate_or_edit_image çağır. İlgili executor tamamlanmadan desteklenmiyor veya yapamıyorum diye final verme. Executorın tanımlamadığı karmaşık operasyonu ise yapmış gibi gösterme. Artifact UI dosya kartıyla teslim edilir.'
            : '',
''',
)
replace_exact(
    core,
    '''          if (!functionCalls.length) {
            const spreadsheetAttachmentsAvailable = listedSpreadsheetAttachmentCount() > 0
            const spreadsheetSyncCompleted = executionToolWasRun('sync_spreadsheet_with_jira_export')
            if (spreadsheetSyncRequested && spreadsheetAttachmentsAvailable && !spreadsheetSyncCompleted) {
''',
    '''          if (!functionCalls.length) {
            const spreadsheetAttachmentsAvailable = listedSpreadsheetAttachmentCount() > 0
            const spreadsheetSyncCompleted = executionToolWasRun('sync_spreadsheet_with_jira_export')
            const spreadsheetMutationCompleted = anyExecutionToolWasRun(['edit_spreadsheet_file', 'transform_spreadsheet_file'])
            const spreadsheetCreateCompleted = executionToolWasRun('create_spreadsheet_file')
            const artifactMutationCompleted = anyExecutionToolWasRun(['transform_pdf_file', 'edit_office_file', 'create_document_file', 'generate_or_edit_image'])
            if (spreadsheetCreateRequested && !spreadsheetCreateCompleted) {
              if (!mustSynthesize && totalToolCalls < MAX_TOOL_CALLS) {
                runItems.push({ role: 'developer', content: 'SPREADSHEET_CREATE_REQUIRED: Kullanıcı gerçek XLSX dosyası istedi. Final metne geçme; create_spreadsheet_file aracını şimdi çağır ve artifact üret.' })
                emitStatus('synthesizing', 'Excel dosyası oluşturuluyor...')
                continue
              }
              roundText = 'Excel çıktısı bu çalışmada üretilemedi. Dosya oluşturulmuş gibi göstermiyorum.'
            }
            if (spreadsheetMutationRequested && !spreadsheetMutationCompleted) {
              if (!mustSynthesize && totalToolCalls < MAX_TOOL_CALLS) {
                runItems.push({ role: 'developer', content: spreadsheetAttachmentsAvailable
                  ? 'SPREADSHEET_MUTATION_REQUIRED: XLSX dosyası bulundu. Final metne geçme; mevcut inspect sonuçlarını kullan veya gerekiyorsa inspect et ve edit_spreadsheet_file/transform_spreadsheet_file aracını çağır.'
                  : 'SPREADSHEET_MUTATION_REQUIRED: Kullanıcı gerçek XLSX değişikliği istedi. Önce list_spreadsheet_attachments ile workspace dosyalarını bul; kayıt varsa dosyanın eksik olduğunu söyleme. Sonra inspect ve uygun edit/transform aracını tamamla.' })
                emitStatus('synthesizing', 'Excel değişikliği uygulanıyor...')
                continue
              }
              roundText = 'Excel değişikliği executor tarafından tamamlanamadı; dosya değiştirilmiş gibi göstermiyorum.'
            }
            if (artifactMutationRequested && !artifactMutationCompleted) {
              if (!mustSynthesize && totalToolCalls < MAX_TOOL_CALLS) {
                runItems.push({ role: 'developer', content: listedActionAttachmentCount() > 0
                  ? 'ARTIFACT_MUTATION_REQUIRED: Görev dosyaları bulundu. Final metne geçme; istenen format için uygun artifact executorını çağır.'
                  : 'ARTIFACT_MUTATION_REQUIRED: Kullanıcı gerçek PDF/DOCX/PPTX/Image artifactı istedi. Mevcut dosya gerekiyorsa list_action_attachments ile bul; yeni üretimse doğrudan create_document_file veya generate_or_edit_image kullan. Executor tamamlanmadan final verme.' })
                emitStatus('synthesizing', 'Dosya işlemi tamamlanıyor...')
                continue
              }
              roundText = 'İstenen dosya işlemi executor tarafından tamamlanamadı; artifact üretilmiş gibi göstermiyorum.'
            }
            if (spreadsheetSyncRequested && spreadsheetAttachmentsAvailable && !spreadsheetSyncCompleted) {
''',
)

replace_exact(
    'src/services/__tests__/spreadsheetExecutionLayer.test.ts',
    '''    expect(executionNames).toEqual([
      'list_spreadsheet_attachments',
      'inspect_spreadsheet_file',
      'sync_spreadsheet_with_jira_export',
    ])
''',
    '''    expect(executionNames).toEqual([
      'list_spreadsheet_attachments',
      'inspect_spreadsheet_file',
      'edit_spreadsheet_file',
      'transform_spreadsheet_file',
      'create_spreadsheet_file',
      'validate_spreadsheet_file',
      'sync_spreadsheet_with_jira_export',
    ])
''',
)
