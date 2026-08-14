# Skill Runtime Wiring Execution Plan

Bu branch üzerinde mevcut runtime dosyaları skill capabilitylerini OpenAI ve Gemini primary-agent turlarına bağlayacak şekilde değiştirildi.

- `search_skills` ve `load_skills` yalnız prosedür keşfi/materialization için kullanılır.
- Skill çıktıları kurumsal knowledge evidence veya citation sayılmaz.
- Skill tool çağrıları mevcut assistant tool audit ledger'a yazılır.
- Knowledge tool görünürlüğü mevcut karar politikasını korur.
- Gemini provider web capability, generic tool availability'den ayrılır; yalnız web gerçekten izinliyse etkinleştirilir.
- Gemini knowledge enumeration fast path yalnız enumeration knowledge tool'ları gerçekten sunulduğunda çalışır; skill-only turlar bunu tetiklemez.
- Final synthesis turunda yeni skill/tool çağrısı açılmaz.
- Main merge ve production deploy bu branch kapsamının dışındadır.

## Durum

Runtime wiring ve regression guard testleri branch'e commit edildi. Merge/deploy öncesi repository CI sonuçları ayrıca doğrulanmalıdır.
