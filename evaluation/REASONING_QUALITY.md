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

LOW/simple turn'lerde kurumsal bilgi veya web araması beklenmez. Bu turn'lerde gereksiz tool çağrısı da kalite regresyonudur.

## 3. Live canaries

Pull request CI, gerçek Supabase test hesabı ile izole `openai-assistant-golden-canary` core'una üç küçük canary gönderir:

- basit doğrudan cevap
- SAP/CRM teknik teşhis + Knowledge v2
- güncel resmi doküman araştırması + web search

Canary runner geçici proje/workspace yaratır, SSE stage ve source event'lerini ölçer, ardından test verisini temizler. Kullanıcıya ait üretim workspace'leri kullanılmaz.

Normal kabul kriteri:

- critical average score: **>= 85**
- critical hard failure: **0**
- required-web senaryosunda en az bir gerçek `https://` web kaynağı

### Provider / environment block

Bir harici sağlayıcı quota, billing veya kredi nedeniyle kullanılamıyorsa bu durum ürün regresyonu ile aynı şey değildir. Canary bunu `environmentBlocked` olarak ayrıca raporlar ve o senaryoyu kalite ortalamasına katmaz.

Ancak ürün davranışı **fail-closed** olmalıdır: `webMode=required` bir talepte doğrulanabilir web kanıtı alınamazsa JetWork nihai cevabı üretmemeli ve araştırmanın sağlayıcı/kota nedeniyle tamamlanamadığını açıkça bildirmelidir. Web kanıtı yokken başarılı araştırma cevabı üretmek kalite hatasıdır.

En az iki kritik, environment-blocked olmayan canary yine başarıyla değerlendirilebilmelidir; aksi durumda live canary başarısız sayılır.

## 4. Production canary

`.github/workflows/reasoning-live-canary.yml` manuel `workflow_dispatch` ile production `openai-assistant-v2` endpoint'ine aynı canary sözleşmesini uygular ve JSON kalite raporunu artifact olarak saklar.

Bu workflow otomatik `main` push'una bağlı değildir; production doğrulaması gerektiğinde kontrollü olarak çalıştırılır. Böylece geçici PR canary endpoint'i veya provider maliyeti production deploy'u rastlantısal biçimde bloke etmez.

## 5. Neden iki gate var?

Deterministic gate hızlı ve kararlıdır; her PR'da routing sözleşmesini korur. Live canary ise model/provider/tool davranışındaki gerçek entegrasyon değişimlerini yakalar. Böylece testler yalnızca mock veya prompt beklentisine bağlı kalmaz.

## 6. Baseline

`evaluation/results/reasoning-live-canary-baseline.json` son doğrulanmış live baseline'dır. 2026-08-08 baseline'ında:

- simple: **100/100**, 0 Knowledge source, 0 Web source
- SAP diagnosis: **100/100**, 16 Knowledge source, verification tamamlandı
- required web: OpenAI API kredi/billing engeli nedeniyle `environmentBlocked=provider_quota_or_billing`; JetWork fail-closed davranıp nihai araştırma cevabı üretmedi

## 7. Golden set değişiklik politikası

Bir regression yakalandığında beklenen sonucu mevcut davranışa uydurmak varsayılan çözüm değildir. Önce şu ayrım yapılır:

1. Ürün davranışı yanlışsa runtime/router düzeltilir.
2. Beklenti gerçekten hatalıysa senaryo gerekçesiyle revize edilir.
3. Yeni bir davranış bilinçli olarak değiştiriliyorsa eski ve yeni kalite skorları PR açıklamasında karşılaştırılır.

Bu dosya Reasoning Quality paketinin sözleşmesidir; sonraki `E2E/Product Quality Hardening` ve `Reasoning Observability` paketleri bu temel metrikleri kullanacaktır.
