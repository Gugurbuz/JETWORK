# XLSX Execution Live Canary

JetWork single-assistant runtime içinde `.xlsx` dosyaları varsayılan olarak metin sohbet eki değil, `tool_input` execution attachment olarak ele alınır.

Canlı canary başarı koşulları:

1. XLSX seçildiğinde attachment `tool_input` olarak işaretlenir.
2. Kullanıcı mesajı kaydedilmeden önce dosya private `assistant-files` bucket'ına yüklenir ve mesajda yalnız `storageBucket` / `storagePath` referansı kalır.
3. XLSX legacy `readAttachmentText` akışına girmez ve "sohbet eki metin olarak okunamıyor" hatası üretilmez.
4. Assistant `list_spreadsheet_attachments` ile gerçek attachment ID'lerini keşfedebilir.
5. `inspect_spreadsheet_file` workbook yapısını okuyabilir.
6. İstenen dönüşümde `sync_spreadsheet_with_jira_export` çalışır, çıktı tekrar açılarak QA edilir ve private artifact signed URL ile döner.
7. Execution sonuçları grounding/citation kanıtı değildir (`executionOnly=true`, `citationReady=false`, `sources=[]`).

2026-08-14 canlı canary sırasında tespit edilen routing hatası: UI iki XLSX'i `chat_only` olarak persist etmiş, `assistant-files` bucket boş kalmış ve runtime dosyaları legacy text-attachment guard'ına göndermiştir. `6ae780e79e15a430af90f7dc8bad15c06d769955` hotfix'i XLSX default purpose, shared attachment persistence ve defensive text-parser bypass katmanlarını birlikte düzeltir.

Aynı doğrulama sırasında response-boundary grounding için ek güvenlik sınırı da kilitlendi: kullanıcı bir enterprise identifier'ı gereksinim olarak verdiğinde bu bilgi analiz bağlamı olarak kullanılabilir; ancak `CHECK_ZTKS hangi mesajları üretiyor?` gibi exact technical fact lookup veya explicit strict-grounding isteklerinde identifier'ın kullanıcı mesajında geçmesi kanıt sayılmaz. Public web kaynağı enterprise evidence değildir; doğrulanmış knowledge evidence olmadan kesin teknik iddia fail-closed kalır.
