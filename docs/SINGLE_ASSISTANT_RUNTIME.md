# JetWork Tek Asistan Çalışma Zamanı

Bu paket, eski çok katmanlı BA/Gemini akışını silmeden yeni tek asistan çekirdeğini devreye alır.

## Çalışma biçimi

- Model: `gpt-5.6-sol`
- API: OpenAI Responses API
- Durum: `store: false`; konuşma öğeleri Supabase `assistant_conversations.state_items` alanında tutulur.
- Talimat: yalnız aktif `assistant_prompt_versions` kaydı; tarayıcı bu tabloyu okuyamaz.
- Retrieval: yalnız workspace-kısıtlı, salt-okunur bilgi bankası araçları.
- Dosya kapsamı: ilk sürümde TXT ve MD.
- Yayın politikası: yeni kaynaklar taslak oluşur; kullanıcı yayımlamadan asistan kullanmaz.

## Sunucu kurulumu

1. Migration'ları sırayla uygula.
2. OpenAI anahtarını Supabase Edge Function secret'ı olarak tanımla:

   ```text
   supabase secrets set OPENAI_API_KEY=...
   ```

3. İsteğe bağlı model sabitlemesi:

   ```text
   supabase secrets set OPENAI_MODEL=gpt-5.6-sol
   ```

4. `openai-assistant` Edge Function'ını JWT doğrulaması açık biçimde yayımla.
5. Endpoint ve beş golden soru doğrulandıktan sonra ön yüzde:

   ```text
   VITE_SINGLE_ASSISTANT_RUNTIME=true
   ```

## Güvenlik sınırları

- OpenAI anahtarı hiçbir zaman tarayıcıya gönderilmez.
- Model SQL, yazma veya genel ağ aracı alamaz.
- Tüm katalog araçları kullanıcının JWT'si ve RLS ile çalışır.
- Yayınlanan kaynak, nesne kimliği, içerik ve ilişkiler exact source/object version'larına pinlenir; yeni ingest taslağı canlı cevabı değiştirmez.
- Anonim oturumlar kurumsal asistan ve bilgi bankasına erişemez.
- Aktif sistem talimatını yalnız server-side service role okuyabilir.
- Mesaj kimliği idempotency anahtarıdır; turn lease'i, çalışma alanı kilidi, istek kotası ve çıktı limiti çift üretim ile maliyet taşmasını sınırlar.
- Conversation, turn ve tool audit tablolarına tarayıcı rolü erişemez.
- Doküman ve araç çıktıları güvenilmeyen veri kabul edilir; içlerindeki talimatlar uygulanmaz.
- Başka workspace'e ait nesneler araç sonucuna giremez.

## Rollback

`VITE_SINGLE_ASSISTANT_RUNTIME=false` yapıldığında mevcut Gemini/BA çalışma zamanı tekrar kullanılır. Yeni tablolar ve bilgi bankası verileri korunur; otomatik Gemini fallback yapılmaz.

## Pilot kabul kapısı

İlk beş soru:

1. `ZCRM2-338 nedir?`
2. `CHECK_KACAK_POD ne yapıyor?`
3. `ZBIL_CS_POD_OPERAND nerede çağrılıyor?`
4. `CHECK_ZTKS hangi mesajları üretiyor?`
5. `ZCRM2-545 hangi koşulda alınır?`

Canlı pilot için CRM dosyaları tek bir gerçek hedef workspace'e yüklenmeli, taslak kaynaklar kullanıcı tarafından yayımlanmalı ve sorular bu workspace'te çalıştırılmalıdır.
