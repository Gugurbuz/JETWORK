# Reasoning Quality Golden Set

JetWork Reasoning Engine kalitesi iki ayrı katmanda ölçülür. Amaç yalnızca model cevabını örneklemek değil; router, kanıt politikası ve gerçek orchestration davranışını sürümden sürüme korumaktır.

## 1. Deterministic contract gate

`pnpm run verify:reasoning-golden`

24 temsilî senaryoyu gerçek `routeReasoningRequest` fonksiyonuna karşı çalıştırır. Aşağıdaki kategoriler zorunludur:

- simple
- SAP diagnosis
- analysis
- decision
- research
- project
- document
- attachment

Bu gate için kabul kriteri:

- route score: **100/100**
- critical route score: **100/100**
- critical hard failure: **0**

Router değişikliği bu sözleşmeyi bozarsa CI doğrudan kırmızı olur.

## 2. Observable runtime evaluation

Gerçek Reasoning Engine run'ı sekiz kriterde deterministic olarak değerlendirilir:

1. route accuracy
2. stage discipline
3. knowledge policy
4. web policy
5. verification policy
6. tool depth
7. answer discipline
8. completion

Önemli kanıt eksiklikleri `hard failure` sayılır. Örnekler:

- SAP/CRM teknik teşhisinde zorunlu kurumsal kanıtın hiç kullanılmaması
- güncel web araştırmasında gerçek web URL kaynağı bulunmaması
- verification gereken bir run'ın doğrulama aşamasını atlaması
- hiç kanıt yokken kesin ve doğrulanmış gibi kök neden iddiası kurulması
- runtime'ın tamamlanmaması

## 3. Live canaries

CI, gerçek Supabase test hesabı ile izole `openai-assistant-golden-canary` core'una üç küçük canary gönderir:

- basit doğrudan cevap
- SAP/CRM teknik teşhis + Knowledge v2
- güncel resmi doküman araştırması + web search

Canary runner geçici proje/workspace yaratır, SSE stage ve source event'lerini ölçer, ardından test verisini temizler. Kullanıcıya ait üretim workspace'leri kullanılmaz.

Canary kabul kriteri:

- critical average score: **>= 85**
- critical hard failure: **0**
- required-web senaryosunda en az bir gerçek `https://` web kaynağı

## 4. Neden iki gate var?

Deterministic gate hızlı ve kararlıdır; her PR'da routing sözleşmesini korur. Live canary ise model/provider/tool davranışındaki gerçek entegrasyon değişimlerini yakalar. Böylece testler yalnızca mock veya prompt beklentisine bağlı kalmaz.

## 5. Golden set değişiklik politikası

Bir regression yakalandığında beklenen sonucu mevcut davranışa uydurmak varsayılan çözüm değildir. Önce şu ayrım yapılır:

1. Ürün davranışı yanlışsa runtime/router düzeltilir.
2. Beklenti gerçekten hatalıysa senaryo gerekçesiyle revize edilir.
3. Yeni bir davranış bilinçli olarak değiştiriliyorsa eski ve yeni kalite skorları PR açıklamasında karşılaştırılır.

Bu dosya Reasoning Quality paketinin sözleşmesidir; sonraki `E2E/Product Quality Hardening` ve `Reasoning Observability` paketleri bu temel metrikleri kullanacaktır.
