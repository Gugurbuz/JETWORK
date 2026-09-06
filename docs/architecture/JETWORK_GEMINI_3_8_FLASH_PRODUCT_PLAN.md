# JETWORK · Gemini 3.8 Flash Product & Architecture Plan

**Belge türü:** Ürün + UX/UI + Runtime + Mimari Uygulama Planı  
**Tarih:** 06.09.2026  
**Durum:** Revizyon 3 — native-first uygulama planı / production hardening
**Hedef model:** `gemini-3.8-flash`  
**Ana mimari referans:** `JETWORK_Agentic_Runtime_Teknik_Master_Plan`  
**Temel ilke:** **LLM decides → Runtime executes/guards → Observation returns → LLM re-plans**

---

## 0. Yönetici Kararı

Gemini 3.8 Flash, JetWork'te yalnızca “bir model seçeneği” olarak eklenmeyecek. JetWork'ün agentic runtime mimarisinin **production default workhorse controller modeli** olarak kullanılacaktır.

Ancak bu karar, modelin güçlü özelliklerini JetWork mimarisinin yerine geçirmek anlamına gelmez. Tam tersine:

- **Gemini 3.8 Flash = aktif semantik controller / reasoning engine**
- **JetWork Runtime = execution, guardrail, state, evidence, authorization, persistence, telemetry**
- **Capability Discovery = yalnız aday capability getirir; karar vermez**
- **Evidence subsystem = tool çıktısını claim/source/coverage ilişkisine dönüştürür**
- **Artifact Runtime = structured output → executor → reload/QA → persistence**
- **UI = modelin iç detaylarını değil kullanıcının iş akışını görünür kılar**

### Production kararı

`auto` modunun tercih edilen provider/model kombinasyonu:

```text
provider = gemini
model    = gemini-3.8-flash
thinking = MEDIUM
```

Kullanıcı açıkça `gemini-3.8-flash` seçtiyse **sessiz provider fallback yapılmaz**. Hata, explicit recovery veya kullanıcıya görünür provider failure olarak ele alınır. Bu, master plandaki provider izolasyonu kuralını korur.

`auto` modunda gelecekte kontrollü fallback desteklenebilir; ancak bu durumda fallback açıkça telemetry'ye ve kullanıcı durum mesajına yansıtılmalıdır. “Gemini seçildi ama arkada başka model cevapladı” davranışı yasaktır.

---

## 1. Google Tarafındaki 3.8 Flash Kabiliyetleri ve JetWork Karşılığı

Google Cloud güncel dokümantasyonuna göre Gemini 3.8 Flash:

- GA durumundadır.
- Model ID: `gemini-3.8-flash`
- 1,048,576 token context window destekler.
- 65,536 maksimum output token destekler.
- Text, image, audio ve video input kabul eder.
- Structured output destekler.
- Function calling destekler.
- Code execution destekler.
- Google Search ve Google Maps grounding destekler.
- URL context destekler.
- Context caching destekler.
- `LOW`, `MEDIUM`, `HIGH` thinking level destekler; default `MEDIUM`.
- `MINIMAL` thinking level desteklemez.
- Gemini 3 ailesinin strict function-call / function-response eşleşme kurallarını uygular.

### JetWork'e etkisi

| Gemini 3.8 özelliği | JetWork'teki ürün/mimari karşılığı |
|---|---|
| Thinking levels | Kullanıcı çalışma modu + controller execution profile |
| Function calling | Agentic Controller → Capability Runtime |
| Structured output | Controller contract, artifact schema, evidence critic output |
| 1M context | Büyük dosya / çoklu kaynak / uzun artifact inceleme; full-history dump için kullanılmaz |
| Multimodal input | PDF görseli, ekran görüntüsü, diagram, ses/video kaynak analizi |
| Google Search grounding | Web capability'nin güçlü bir execution backend'i |
| Maps grounding | Konum/seyahat/field-service use-case'leri için opsiyonel capability |
| URL context | Harici URL araştırma capability'si |
| Context caching | Büyük ama stabil proje bağlamı ve tekrar kullanılan kurumsal context için maliyet/latency optimizasyonu |
| Code execution | Sadece sandbox/guard altında veri dönüştürme ve analiz capability'si; doğrudan sınırsız runtime yetkisi değil |

---

## 2. JetWork Repo Mevcut Durumu

06.09.2026 itibarıyla kod tabanında Gemini 3.8 geçişinin önemli bölümü başlamıştır.

### Halihazırda mevcut olanlar

1. UI model selector'larında `gemini-3.8-flash` görünür.
2. `PUBLIC_GEMINI_MODEL` ve `DEFAULT_GEMINI_MODEL` 3.8 Flash'a normalize edilmiştir.
3. Assistant gateway tarafında `DEFAULT_GEMINI_RUNTIME_MODEL = 'gemini-3.8-flash'` mevcuttur.
4. Legacy Gemini model seçimleri yeni runtime modeline normalize edilmektedir.
5. Trivial assistant fast-path Gemini 3.8'e taşınmıştır.
6. Deterministic Gemini web research executor 3.8 Flash kullanmaktadır ve `thinking_level: low` ile çalışmaktadır.
7. Migration'larda yeni runtime isteklerinin 3.8 modelini persist etmesine yönelik geçiş başlamıştır.
8. 3.8 model normalization/cost guard/regression testleri eklenmiştir.

### Mevcut durumun riski

3.8'e model string'ini geçirmek **ürün entegrasyonunun tamamlandığı anlamına gelmez**.

Kod tabanında hâlâ aşağıdaki mimari riskler vardır:

- semantik fast-path'ler,
- deterministic web research karar yolları,
- semantic orchestrator / özel routing mantığı,
- provider/model seçimi ile capability seçiminin yer yer birbirine karışması,
- thinking level'in task semantics'i dışarıdan tahmin edilerek seçilme riski,
- strict Gemini function call contract'ının agent loop boyunca eksiksiz doğrulanmaması,
- multimodal capability'nin evidence/artifact pipeline'a tam bağlanmamış olması.

Dolayısıyla hedef **“3.8 modeline geçtik”** değil, **“3.8 özelliklerini master plan mimarisine doğru yerleştirdik”** olmalıdır.

---

## 3. Değişmeyecek Mimari Kurallar

Gemini 3.8 güçlü olduğu için JetWork runtime'ına yeni bir ikinci semantik beyin eklenmeyecek.

**Karar sahibi Gemini'dir:** Kullanıcı niyetini yorumlama, araç seçimi, planı değiştirme, kanıt yeterliliği ve kullanıcıya açıklama kararlarını aktif Gemini controller verir. JETWORK Agent bu modelin çalıştığı uygulama sınırıdır; ikinci planner değildir. SDK'nın izinli native AFC döngüsü mekanik yürütmeyi üstlenebilir; yetki ve kalıcı iş yaşam döngüsü JETWORK'te kalır. Ayrıntılı sorumluluk matrisi §38, ara mesaj deneyimi §39 ve kabul testleri §40'tadır.

### Kural 1 — Tek semantik otorite

```text
User
 ↓
Context Resolver
 ↓
Capability Candidate Retrieval
 ↓
Gemini 3.8 Controller
 ↓
Capability / Final kararı
```

Runtime şu tür kararları **vermez**:

```ts
if (looksLikeSAPIdentifier(message)) routeToKnowledge()
if (message.includes('doküman')) routeToArtifact()
if (looksComplex(message)) thinkingLevel = 'HIGH'
if (needsWeb(message)) runGeminiSearch()
```

Bunun yerine controller'a durum + capability adayları verilir ve actual semantic seçim Gemini 3.8 tarafından yapılır.

### Kural 2 — Runtime yalnız mekanik guard uygular

Runtime'ın yetkileri:

- auth / RLS
- schema validation
- idempotency
- turn lease
- rate limit
- timeout
- token/call budget
- capability authorization
- persistence
- evidence normalization
- telemetry
- failure taxonomy

### Kural 3 — Büyük context window full-history dump değildir

1M context window bir “her şeyi prompt'a atalım” lisansı değildir.

JetWork yine:

```text
recent conversation
+ resolved conversation state
+ relevant project memory
+ selected evidence
+ active artifact state
```

kullanacaktır.

1M context yalnız gerçekten büyük input gerektiğinde avantaj olarak kullanılacaktır.

---

## 4. Hedef Runtime Mimarisi

```text
┌──────────────────────────────────────────────────────────────┐
│                        JETWORK CLIENT                       │
│ Chat | Files | Sources | Artifact | Status | Work Mode     │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    ASSISTANT GATEWAY                        │
│ Auth | RLS | Rate Limit | Lease | Idempotency | SSE        │
│                    SEMANTİK KARAR YOK                       │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     CONTEXT RESOLVER                        │
│ Recent | Resolved State | Project Memory | Files | Artifact│
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  CAPABILITY DISCOVERY                       │
│ Semantic Top-K candidates only                             │
│              ACTUAL CAPABILITY KARARI YOK                   │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│               GEMINI 3.8 FLASH CONTROLLER                  │
│                    thinking=MEDIUM                          │
│ Goal | State | Capabilities | Evidence | Budget            │
│ Next action? Tool? More evidence? Artifact? Final?          │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    CAPABILITY RUNTIME                       │
│ Knowledge | Web | File | Multimodal | BA | Artifact | Code │
│ schema | auth | timeout | budget | execution                │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                  OBSERVATION NORMALIZER                     │
│ text | structured | media | source refs | errors            │
└───────────────┬──────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│                    EVIDENCE LEDGER                          │
│ support | gap | conflict | source trust | coverage          │
└───────────────┬──────────────────────────────────────────────┘
                │
                └──────────────► Gemini 3.8 re-plan
                                   │
                                   ├── more capability
                                   ├── final text
                                   └── artifact contract
```

---

## 5. Gemini Structured Output = Controller Contract

Gemini 3.8'in structured output kabiliyeti JetWork için kritik bir avantajdır.

Controller'ın yürütülebilir kararları tipli ve doğrulanmış sözleşmeye dönüştürülmelidir. Native function calling/AFC kullanıldığında SDK'nın function call sözleşmesi bu ihtiyacı karşılayabilir; aynı kararı ayrıca JSON ürettirmek için ikinci model çağrısı yapılmaz. Aşağıdaki JSON, manuel controller yolu için önerilen uygulama sözleşmesidir. Public ara mesajlar ve final metni yürütme kararından ayrı kanallarda taşınır.

### Önerilen controller schema

```json
{
  "type": "object",
  "properties": {
    "action": {
      "enum": ["call_capability", "final", "artifact"]
    },
    "capability_id": {
      "type": ["string", "null"]
    },
    "arguments": {
      "type": "object"
    },
    "evidence_status": {
      "enum": ["none", "partial", "sufficient", "conflict"]
    },
    "execution_profile": {
      "enum": ["default", "fast", "deep"]
    },
    "finalization_reason": {
      "type": ["string", "null"]
    }
  },
  "required": [
    "action",
    "capability_id",
    "arguments",
    "evidence_status",
    "execution_profile",
    "finalization_reason"
  ]
}
```

### Önemli

`execution_profile` bir sonraki capability veya downstream generation için hint olabilir. Runtime bu alanı deterministic task classifier gibi kendisi üretmez.

Controller'ın kendi ilk invocation'ı varsayılan olarak `MEDIUM` kalır. Böylece “task karmaşık mı?” diye runtime'da yeni bir semantic router oluşmaz.

---

## 6. Thinking Level Ürün Politikası

Gemini 3.8 için valid thinking seviyeleri:

```text
LOW
MEDIUM
HIGH
```

`MINIMAL` kullanılmayacaktır.

### 6.1 Default

```text
AUTO / normal chat / controller = MEDIUM
```

Sebep:

- Google tarafından default olarak önerilen denge noktasıdır.
- JetWork agentic task'lerinde ilk karar kalitesini korur.
- Runtime'ın task complexity classifier'a dönüşmesini engeller.

### 6.2 LOW

LOW şu durumlarda kullanılabilir:

- kullanıcı açıkça “Hızlı” çalışma modunu seçtiyse,
- controller downstream capability için `execution_profile=fast` seçtiyse,
- deterministik olmayan ama basit extraction/summarization alt görevi varsa,
- web result snippet normalizasyonu gibi düşük reasoning gerektiren yardımcı generation'da.

### 6.3 HIGH

HIGH şu durumlarda kullanılabilir:

- kullanıcı açıkça “Derin” mod seçtiyse,
- controller multi-hop araştırma veya karmaşık artifact reasoning için `execution_profile=deep` istediğinde,
- critic tarafından ciddi evidence conflict/gap sinyali geldikten sonra controller daha yoğun analiz talep ettiğinde.

### Yasak

```ts
const isComplex = /analiz|mimari|SAP|doküman/.test(message)
thinkingLevel = isComplex ? 'HIGH' : 'LOW'
```

Bu, master planın kaldırdığı deterministic semantic routing'in yeni isimle geri dönmesidir.

---

## 7. UI/UX Ürün Tasarımı

Gemini 3.8'in teknik detaylarını kullanıcıya sürekli model parametresi olarak göstermek yerine, kullanıcıya **iş davranışı** gösterilmelidir.

## 7.1 Model selector

Normal kullanıcı için önerilen görünüm:

```text
Otomatik (önerilen)
OpenAI GPT-5.6 Sol
OpenAI GPT-5.6
Gemini 3.8 Flash
```

`Otomatik` varsayılan olarak Gemini 3.8 Flash kullanır.

Explicit model seçimi advanced/diagnostic kullanıcı davranışı olarak korunur.

## 7.2 Work mode

Model selector'dan ayrı bir çalışma modu:

```text
Hızlı
Dengeli  ← default
Derin
```

Anlamı:

| UI modu | Gemini policy |
|---|---|
| Hızlı | LOW preference |
| Dengeli | MEDIUM |
| Derin | HIGH preference |

Bu bir “hangi capability?” kararı değildir; kullanıcı tarafından açıkça seçilmiş compute/latency tercihi olduğu için mimariyi bozmaz.

## 7.3 Status messages

UI provider iç reasoning'ini veya chain-of-thought'u göstermez.

Asistan ayrıca doğal dilde başlangıç, ara bulgu, yaklaşım değişikliği ve engel mesajları gönderir. Bu mesajların içeriğine Gemini, gerçek sonuçları esas alarak karar verir. Yalnız animasyon veya durum etiketi yeterli değildir. Mesajlar konuşmada saklanır; final yanıttan ayrı tutulur. Zamanlama, event sözleşmesi, örnek konuşma ve yeniden bağlanma davranışı §39'da tanımlıdır.

Runtime'ın gerçek olaylara dayanarak gösterebileceği yapılandırılmış status örnekleri:

```text
Kaynaklar taranıyor
3 ilgili kaynak bulundu
Teknik detay doğrulanıyor
Kanıtlar karşılaştırılıyor
Doküman hazırlanıyor
Doküman doğrulanıyor
Yanıt hazırlanıyor
```

Gösterilmeyecek:

```text
Gemini şu anda 2187 thinking token kullandı
Model şöyle düşündü...
Internal reasoning: ...
```

## 7.4 Evidence UX

Her güçlü teknik cevapta kaynak deneyimi:

```text
Yanıt
 ├─ claim 1 [Kaynak 1]
 ├─ claim 2 [Kaynak 2]
 └─ claim 3 [Kaynak 1, 3]

Kaynaklar paneli
 ├─ Doküman adı
 ├─ bölüm / object / chunk
 ├─ güven seviyesi
 └─ aç
```

## 7.5 Multimodal UX

Kullanıcı:

- ekran görüntüsü,
- PDF,
- diagram,
- fotoğraf,
- ses,
- video

yüklediğinde JetWork dosyayı yalnız “attachment” olarak göstermemelidir.

Önerilen status:

```text
Dosya inceleniyor
Görsel içerik analiz ediliyor
Tablo/diagram ilişkileri çıkarılıyor
İlgili bölümler kanıt listesine eklendi
```

---

## 8. Multimodal Kaynak İşleme

Gemini 3.8'in multimodal özelliği özellikle JetWork knowledge/artifact tarafında önemli kazanım sağlar.

### Bugünkü klasik yaklaşım

```text
PDF
 ↓
text extraction
 ↓
chunk
 ↓
embedding
 ↓
RAG
```

Bu, diagram/table/screenshot anlamını kaybedebilir.

### Hedef hibrit yaklaşım

```text
FILE
 ├─ text extraction / chunking ──► searchable knowledge index
 ├─ visual page representation ──► Gemini multimodal inspection
 └─ metadata / structure ─────────► evidence ledger
```

### Kullanım örnekleri

1. SAP ekran görüntüsündeki alanları doğrudan analiz etme.
2. Mimari diagramdaki servis ilişkilerini çıkarma.
3. PowerPoint screenshot'larındaki KPI / chart bağlamını anlama.
4. PDF içinde text extraction'ın bozduğu tabloları multimodal doğrulama.
5. Fotoğraftaki fiziksel sayaç/cihaz/etiket içeriğini yorumlama.
6. Video içinde süreç walkthrough veya UI demo analizi.

### Kural

Multimodal model çıktısı doğrudan “kurumsal gerçek” değildir.

Observation → Evidence Ledger → source reference akışına girmelidir.

---

## 9. Web Research / Grounding Tasarımı

Gemini 3.8 Google Search grounding desteklediği için JetWork web capability'sinin güçlü backend'lerinden biri olabilir.

Ancak:

```text
Controller
 ↓ chooses web.search
Web Capability
 ↓ Gemini Search Grounding / alternative search backend
Normalized Results
 ↓
Evidence Ledger
 ↓
Controller Re-plan
```

olmalıdır.

### Yasak mimari

```text
if (needsFreshInfo(message)) {
  return deterministicGeminiWebResearch(message)
}
```

Çünkü “needsFreshInfo” semantik bir karardır.

### Hedef

Mevcut deterministic Gemini web research executor:

- execution backend olarak korunabilir,
- ancak **controller'ın seçtiği web capability'nin içinde** çalışmalıdır,
- kendi başına semantic router olmamalıdır.

### Grounded response kaydı

Web observation şu şekilde normalize edilmelidir:

```json
{
  "source_type": "web",
  "query": "...",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "retrieved_at": "..."
    }
  ]
}
```

Ardından evidence map bu source'ları claim'lerle eşleştirir.

---

## 10. Strict Function Calling Uyum Planı

Gemini 3.8 function calling tarafında strict eşleşme kurallarını uygular.

JetWork için bu kritik production gate'tir.

### Her function call için tutulacak alanlar

```ts
interface JetWorkToolCall {
  providerCallId: string
  providerFunctionName: string
  capabilityId: string
  runtimeCallId: string
  round: number
  argsHash: string
}
```

### Function response invariant

Bir tool response:

- preceding function call `id/call_id` ile eşleşmeli,
- function name birebir eşleşmeli,
- call sayısı / response sayısı uyuşmalı,
- eksik tool response ile yeni model turn'ü başlatılmamalı,
- multimodal response part varsa doğru function response payload içinde bulunmalı.

### Testler

- single tool call
- parallel/multiple tool calls
- one tool failure
- partial response attempt
- duplicate runtime response
- reordered responses
- invalid call id
- mismatched function name
- multimodal function response
- controller re-plan after tool error

Bu testler production rollout öncesi critical golden set'e eklenmelidir.

---

## 11. API Compatibility / Migration Guard

Gemini 3.8'e geçişte legacy provider parametreleri temizlenmelidir.

### Thinking

Eski:

```json
{
  "thinking_budget": 4000
}
```

Yeni:

```json
{
  "thinking_level": "MEDIUM"
}
```

### Kullanılmaması gereken legacy / unsupported alanlar

Gemini 3.8 request builder'larında aşağıdakiler gönderilmemelidir:

- `temperature`
- `top_p`
- `top_k`
- `candidate_count`
- `frequency_penalty`
- `presence_penalty`
- prefilled `model` turns
- `thinking_level: MINIMAL`

### Contract test

Repo seviyesinde bir provider contract testi source taraması yapmalıdır:

```text
all gemini-3.8 request builders
  ✓ no unsupported fields
  ✓ valid thinking level
  ✓ no prefilled model turn
  ✓ strict function ids
  ✓ response schema valid
```

---

## 12. Context Caching Stratejisi

Context caching doğrudan P7 latency/cost optimizasyonuna bağlanmalıdır.

### Cache'e aday içerik

- uzun ve stabil system instructions,
- büyük project context pack,
- sık kullanılan kurumsal standard / policy source pack,
- aynı artifact üzerinde tekrar tekrar çalışan büyük document context,
- büyük ama immutable referans veri.

### Cache'e alınmaması gereken içerik

- her turn değişen recent conversation,
- sensitive ephemeral tool result,
- kullanıcı düzeltmesi bekleyen hypothesis,
- sık invalidation gerektiren dynamic evidence.

### Cache key

```text
workspace_id
+ project_context_version
+ artifact_version
+ capability_manifest_version
+ controller_policy_version
+ source_pack_hash
```

### Invalidation

- source güncellendi,
- artifact version değişti,
- controller policy değişti,
- memory authority değişti,
- user correction geldi.

---

## 13. 1M Context Window Kullanım Politikası

### Kullan

- çok uzun tek dokümanda global cross-reference gerektiğinde,
- birden fazla büyük artifact karşılaştırılırken,
- uzun transcript/audio/video analizinde,
- çok büyük code/source bundle'da scoped deep analysis gerektiğinde.

### Kullanma

- full chat history,
- alakasız project memory,
- tüm knowledge base dump,
- “nasıl olsa sığıyor” yaklaşımı.

### JetWork context budget

Controller'a her turn hedeflenen context:

```text
system/controller policy
+ compact resolved state
+ recent turns
+ top relevant project memory
+ top evidence
+ top capability manifests
```

Large-context escalation ancak controller'ın ihtiyaç sinyali sonrası yapılmalıdır.

---

## 14. Artifact Runtime ile 3.8 Entegrasyonu

Gemini structured output, artifact generation'da doğrudan final DOCX/PPTX/XLSX üretmez.

Doğru akış:

```text
Controller
 ↓
research / evidence
 ↓
artifact capability selected
 ↓
Gemini structured artifact contract
 ↓
Artifact quality gate
 ↓
Executor
 ↓
DOCX / PPTX / XLSX
 ↓
Reload / integrity validation
 ↓
Persistence
 ↓
File card
```

### Gemini'nin rolü

- outline,
- structured section data,
- requirement matrix,
- evidence-linked claim map,
- artifact intent,
- revision patch contract

üretmektir.

### Executor'un rolü

- binary file generation,
- template application,
- formatting,
- page/slide/sheet composition,
- file integrity.

### Artifact completion invariant

```text
Gemini JSON üretti ≠ artifact completed
Executor success ≠ artifact completed
Executor + reload/QA + persistence = completed
```

---

## 15. BA / Enterprise Use Case'leri

## 15.1 SAP teknik soru

User:

> CHECK_ZTKS hangi mesajları üretiyor ve hangi koşullarda?

Akış:

```text
Gemini Controller
 → knowledge catalog search
 → observation
 → exact source/detail retrieval
 → evidence coverage
 → gerekiyorsa ikinci retrieval
 → final
```

## 15.2 BA analizi

User:

> Bu talebin iş analizini hazırla.

Akış:

```text
Controller
 → project context
 → enterprise knowledge
 → evidence
 → BA skill
 → artifact capability
 → structured output
 → executor
 → reload/QA
 → file
```

## 15.3 Görsel SAP ekran analizi

User screenshot yükler:

```text
Controller
 → multimodal file capability
 → Gemini visual analysis
 → UI fields / errors / relations
 → evidence object
 → gerekirse knowledge lookup
 → final
```

## 15.4 Güncel mevzuat + internal process

```text
Controller
 → web capability
 → enterprise knowledge capability
 → evidence conflict/coverage
 → synthesis
 → cited answer
```

## 15.5 Mimari doküman inceleme

```text
large DOCX/PDF + diagrams
 → text chunks
 → multimodal pages
 → project memory
 → architecture critic skill
 → structured findings
 → artifact revision
```

---

## 16. “Amerika'yı Baştan Keşfetmeme” İlkesi

Gemini 3.8 zaten aşağıdakileri sağlıyorsa JetWork bunları sıfırdan modelle taklit etmeyecektir:

- native function calling,
- structured outputs,
- native multimodal understanding,
- thinking effort control,
- search grounding,
- URL context,
- context caching.

JetWork'ün farklılaştırıcı katmanı şunlardır:

- enterprise authorization,
- Project Brain / durable memory,
- capability registry,
- evidence ledger,
- artifact lifecycle,
- enterprise RAG,
- cross-provider runtime,
- auditability,
- cost/latency telemetry,
- business workflow state,
- production guardrails.

Özet:

```text
Google model kabiliyetini sağlar.
JetWork onu güvenilir enterprise agent runtime'a dönüştürür.
```

---

## 17. Mevcut Fast-Path'lerin Kararı

Master plan ile uyum için tüm fast-path'ler iki sınıfa ayrılmalıdır.

### A — Kalabilir: mekanik fast-path

Örnek:

- exact duplicate request/idempotency,
- cached completed turn replay,
- rate limit response,
- auth failure,
- empty/invalid request,
- mekanik health check.

### B — Kaldırılmalı veya controller altına taşınmalı: semantik fast-path

Örnek:

- “bu soru basit” tespiti,
- “bu identifier” tespiti,
- “web gerekir” tespiti,
- “enumeration sorusu” tespiti,
- “artifact gerekiyor” tespiti,
- “şu domain knowledge tool'una git” tespiti.

### `trivialAssistantFastPath` için özel karar

Bu yol yalnız kesin mekanik/sınırlı UI acknowledgement gibi semantik risk taşımayan girdilere indirilirse korunabilir.

Eğer doğal dili sınıflandırarak “bu basit, agent loop'a gerek yok” kararı veriyorsa P1 mimari kuralına aykırıdır ve controller'a taşınmalıdır.

---

## 18. Capability Catalog Güncellemesi

Gemini 3.8 sonrası önerilen capability family:

```text
knowledge.search
knowledge.get_detail
knowledge.get_source

web.search
web.open_url
web.deep_research

file.inspect
file.multimodal_inspect
file.extract_structure

artifact.plan
artifact.generate
artifact.revise
artifact.verify

analysis.code_sandbox
analysis.data_transform

context.project_memory
context.conversation_state
context.active_artifact
```

Gemini modeline tüm schema'lar gönderilmeyecek.

```text
registry
 ↓
semantic top-k discovery
 ↓
Gemini controller
 ↓
actual selection
```

---

## 19. Telemetry Güncellemesi

Her controller/provider turn için minimum telemetry:

```text
trace_id
turn_id
workspace_id
controller_version
controller_model = gemini-3.8-flash
provider = gemini
thinking_level
controller_round
candidate_capabilities
selected_capability
function_call_id
runtime_call_id
tool_latency_ms
provider_latency_ms
first_token_ms
input_tokens
output_tokens
cached_tokens
provider_calls
tool_calls
evidence_count
evidence_coverage
termination_reason
fallback_used
error_taxonomy
estimated_cost
```

### Loglanmayacak

- private chain-of-thought,
- hidden reasoning text,
- sensitive raw enterprise content gereksizse,
- secret / token / credentials.

---

## 20. Quality + Cost Scorecard

3.8 geçişi yalnız latency veya maliyet ile değerlendirilmez.

### Quality

- task success
- grounded technical claim rate
- citation/source accuracy
- unsupported claims
- retrieval recall
- evidence coverage
- artifact integrity
- follow-up continuity

### Agent behavior

- controller rounds P50/P95
- tool calls P50/P95
- provider calls / successful turn
- replan count
- termination reason distribution

### Performance

- request_to_claim
- claim_to_context
- context_to_controller
- capability_discovery_latency
- controller_decision_latency
- tool_latency
- replan_latency
- final_generation_ttft
- stream_duration
- total_turn

### Cost

Ana metrik:

```text
cost / successful grounded answer
```

Ek metrikler:

```text
cost / completed turn
cost / artifact completed
cost / web-grounded answer
cost / controller round
```

---

## 21. Golden Test Paketi — Gemini 3.8

### G38-01 Simple chat

Beklenti:

- gereksiz tool yok,
- doğru kısa final,
- düşük total latency.

### G38-02 Exact enterprise identifier

`CHECK_ZTKS hangi mesajları üretir?`

Beklenti:

- relevant knowledge capability,
- 544/545/586 recall,
- evidence-backed answer,
- unsupported code yok.

### G38-03 Follow-up

`Peki 545 neden olur?`

Beklenti:

- resolved subject = CHECK_ZTKS,
- prior evidence reuse,
- identifier regex özel yolu yok.

### G38-04 No evidence

Hayali teknik method.

Beklenti:

- hallucinated answer yok,
- “bulamadım / kanıt yok” davranışı.

### G38-05 Web freshness

Güncel dış bilgi.

Beklenti:

- controller web capability seçer,
- source'lar evidence'e girer,
- tarih/freshness korunur.

### G38-06 Multimodal screenshot

Beklenti:

- image part doğru provider payload'ında,
- visual observation,
- source/evidence ilişki kaydı.

### G38-07 Artifact create

Beklenti:

- structured artifact contract,
- executor,
- reload/QA,
- persistence.

### G38-08 Artifact revision

Beklenti:

- yalnız hedef section değişir,
- revision invariants geçer.

### G38-09 Function call strictness

Beklenti:

- call ID/name exact match,
- mismatch test fail.

### G38-10 Long-context

Beklenti:

- tüm history değil resolved context,
- büyük dokümanda cross-reference doğru.

### G38-11 Thinking LOW

Beklenti:

- user-selected Fast mode,
- valid Gemini request,
- latency düşüşü kalite floor içinde.

### G38-12 Thinking HIGH

Beklenti:

- user-selected Deep veya controller downstream deep profile,
- daha yüksek reasoning cost telemetry'de görünür.

### G38-13 Provider isolation

Explicit Gemini failure.

Beklenti:

- silent OpenAI fallback yok.

### G38-14 Unsupported parameters

Beklenti:

- request builder deprecated/unsupported param göndermiyor.

### G38-15 Multi-tool round

Beklenti:

- multiple function calls doğru eşleşir,
- observations controller'a eksiksiz döner.

---

## 22. Uygulama Fazları

## G0 — Contract Hardening

- [ ] Tüm Gemini request builder'ları envanterle.
- [ ] `thinking_budget` kullanımını kaldır.
- [ ] `temperature/top_p/top_k` legacy gönderimlerini kaldır.
- [ ] `candidate_count/frequency_penalty/presence_penalty` gönderimlerini kaldır.
- [ ] Prefilled model turn üretimini engelle.
- [ ] Strict function call ID/name contract ekle.
- [ ] Provider contract testlerini ekle.

**DoD:** Gemini 3.8 request contract testleri %100 yeşil.

## G1 — Controller Native Structured Output

- [ ] Controller decision schema tanımla.
- [ ] Manuel controller yolunda Gemini response schema ile enforce et; native function calling/AFC yolunda aynı kararı tekrar ürettirmeden tipli call sözleşmesini doğrula.
- [ ] Parse failure recovery tanımla.
- [ ] Runtime semantic fallback parser'ı oluşturma.
- [ ] Structured telemetry ekle.

**DoD:** Controller action'ları yalnız valid schema ile execution'a geçer.

## G2 — Thinking Policy

- [ ] Default MEDIUM.
- [ ] UI Hızlı/Dengeli/Derin modu.
- [ ] Explicit user preference persist.
- [ ] Controller downstream `execution_profile` desteği.
- [ ] LOW/HIGH latency-quality benchmark.

**DoD:** thinking level semantic regex ile seçilmiyor.

## G3 — Function Calling Runtime

- [ ] Provider call IDs persist.
- [ ] Runtime call IDs map.
- [ ] Parallel call response mapping.
- [ ] Tool error observation contract.
- [ ] Strict sequence validator.

**DoD:** G38-09 ve G38-15 critical golden %100.

## G4 — Multimodal

- [ ] File capability media contract.
- [ ] Image/PDF visual part support.
- [ ] Audio/video capability policy.
- [ ] Multimodal observation normalizer.
- [ ] Evidence linkage.
- [ ] UI status / source preview.

**DoD:** screenshot + PDF diagram golden başarılı.

## G5 — Web Grounding

- [ ] Existing Gemini web executor'u capability backend'e taşı.
- [ ] Semantic `needsWeb` kararlarını kaldır.
- [ ] Search result normalization.
- [ ] Evidence ledger integration.
- [ ] Freshness / URL / source telemetry.

**DoD:** controller seçmeden web executor çalışmaz.

## G6 — Context Cache + Large Context

- [ ] Cacheable context contract.
- [ ] Cache key/versioning.
- [ ] Invalidation.
- [ ] Cached-token telemetry.
- [ ] Large-context escalation guard.

**DoD:** repeated large project tasks'te cost/latency düşer, quality floor korunur.

## G7 — UX Productization

- [ ] Auto default 3.8.
- [ ] Work mode UI.
- [ ] Structured status feed ve Gemini kaynaklı public ara mesajlar.
- [ ] Commentary/final ayrımı, kalıcılık, reconnect sırası ve iptal davranışı (§39–40).
- [ ] Evidence/source panel iyileştirme.
- [ ] Multimodal upload status.
- [ ] Provider failure transparency.

**DoD:** kullanıcı “hangi model parametresi ne?” bilmeden hızlı/dengeli/derin davranışı kontrol edebilir.

## G8 — Golden + Production Rollout

- [ ] Gemini golden suite.
- [ ] exact SHA baseline.
- [ ] preview deploy.
- [ ] live-like E2E.
- [ ] canary.
- [ ] cost/quality dashboard.
- [ ] rollback flag.

**DoD:** quality baseline altına düşmeden production default rollout.

---

## 23. Master Plan P0–P8 ile Eşleştirme

| Gemini planı | Master plan paketi |
|---|---|
| G0 Contract Hardening | P0 / P1 |
| G1 Controller Structured Output | P1 |
| G2 Thinking Policy | P1 / P7 |
| G3 Function Calling Runtime | P1 |
| G4 Multimodal | P2 / P4 / P5 |
| G5 Web Grounding | P2 / P4 |
| G6 Cache + Large Context | P3 / P7 |
| G7 UX Productization | P5 / P8 |
| G8 Golden + Rollout | P6 / P7 / P8 |

Bu belge master planın yerine geçmez; Gemini 3.8'in master plan içine nasıl yerleşeceğini tanımlar.

---

## 24. Öncelik Sırası

Production default kararı verilmiş olsa da geliştirme sırası şu olmalıdır:

```text
1. API contract hardening
2. strict function calling
3. controller structured output
4. semantic fast-path cleanup
5. web capability migration
6. thinking policy
7. multimodal
8. context caching
9. UX productization
10. golden benchmark
11. P7 latency/cost optimization
12. canary/full rollout
```

En kritik nokta:

**Modeli 3.8 yapmak kolaydır; runtime'ın 3.8'i doğru kullanmasını sağlamak asıl iştir.**

---

## 25. Production Gate

Gemini 3.8'in JetWork production default'u olarak “tamamlandı” sayılması için:

### Architecture

- [ ] Tek semantik otorite controller.
- [ ] Runtime semantic router değil.
- [ ] Discovery yalnız candidate retrieval.
- [ ] Web/search controller-selected capability.
- [ ] Explicit provider selection isolation.

### Provider contract

- [ ] Valid thinking level.
- [ ] Unsupported param yok.
- [ ] Strict function response matching.
- [ ] No prefilled model turns.
- [ ] Structured output parse-safe.

### Quality

- [ ] Critical golden = %100.
- [ ] Task success ≥ agreed floor.
- [ ] Grounded technical claim ≥ agreed floor.
- [ ] Unsupported claims ≤ agreed ceiling.
- [ ] Artifact integrity %100.

### Performance

- [ ] P50/P95 TTFT baseline kayıtlı.
- [ ] P50/P95 total latency kayıtlı.
- [ ] Controller rounds kayıtlı.
- [ ] Provider calls / successful turn kayıtlı.
- [ ] Cost / successful grounded answer kayıtlı.

### UX

- [ ] Auto = 3.8.
- [ ] Hızlı/Dengeli/Derin anlaşılır.
- [ ] Status messages structured; doğal ara mesajlar gerçek bulgulara bağlı.
- [ ] R31-01–R31-12 iletişim ve karar sahipliği kabul testleri başarılı.
- [ ] Source/evidence görünür.
- [ ] Provider failure açık.
- [ ] Multimodal upload flow anlaşılır.

### Operations

- [ ] Canary flag.
- [ ] Rollback config.
- [ ] Failure taxonomy.
- [ ] Dashboard.
- [ ] No silent provider fallback.

---

## 26. ADR Ekleri

### ADR-G38-01

`gemini-3.8-flash`, JetWork `auto` modunun preferred production workhorse modelidir.

### ADR-G38-02

Controller initial thinking level default `MEDIUM` olur. Runtime task semantics'e göre regex/keyword classifier ile thinking level seçmez.

### ADR-G38-03

`LOW/HIGH`, user work-mode tercihi veya controller'ın downstream execution profile kararıyla kullanılabilir.

### ADR-G38-04

Gemini native Google Search grounding bir **web capability execution backend**'idir; controller'ın dışında bağımsız semantic router değildir.

### ADR-G38-05

Gemini structured output, controller ve artifact contract'larında schema enforcement için kullanılacaktır.

### ADR-G38-06

Gemini function calls JetWork capability runtime guard'larını bypass edemez.

### ADR-G38-07

Gemini multimodal observation'ları evidence ledger'a girmeden authoritative enterprise fact sayılmaz.

### ADR-G38-08

1M context window full conversation history gönderme gerekçesi değildir.

### ADR-G38-09

Context caching P7 optimizasyonudur; kalite baseline'ı doğrulanmadan agresif cache/compaction yapılmaz.

### ADR-G38-10

Explicit Gemini selection'da silent OpenAI fallback yasaktır.

---

## 27. Referanslar

- Google Cloud — Gemini 3.8 Flash developer guide: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
- Google Cloud — Gemini 3.8 Flash model page: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash
- Google Cloud — Thinking: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking
- GoogleCloudPlatform Generative AI notebook: https://github.com/GoogleCloudPlatform/generative-ai/blob/main/gemini/getting-started/intro_gemini_3_8_flash.ipynb
- JetWork Agentic Runtime Teknik Master Plan, 02.09.2026

---

## 28. Sonuç

Gemini 3.8 Flash JetWork için üç ayrı kazanım sağlar:

1. **Daha güçlü controller:** agentic, multi-step, coding ve specialized reasoning kalitesi.
2. **Daha zengin capability execution:** function calling, multimodal, web grounding, URL context, structured output.
3. **Daha iyi product economics:** thinking-level kontrolü, context caching ve Flash sınıfı throughput/cost dengesi.

Fakat JetWork'ün gerçek ürünü model değildir.

JetWork'ün gerçek ürünü:

```text
Gemini 3.8 intelligence
+ JetWork enterprise context
+ Project Memory
+ Capability Runtime
+ Evidence Ledger
+ Artifact Engine
+ Guardrails
+ Evaluation
+ Observability
```

birleşimidir.

**Hedef:** Gemini 3.8'i yalnız API'ye bağlamak değil; JetWork'ü 3.8'in native yeteneklerini doğru kullanan, kanıtlı, agentic ve production-grade enterprise çalışma platformuna dönüştürmektir.


---

## 29. Native-first yeniden kullanım envanteri

Bu revizyonun ana uygulama kuralı: önce mevcut kod yolu, sonra resmi SDK, yalnız kanıtlanmış boşluk için özel kod. Yeni bağımlılık veya servis eklemek varsayılan değildir.

| Alan | Hazır kullanacağımız parça | JETWORK'e özgü küçük ek | Yeniden yazılmayacak |
|---|---|---|---|
| Streaming | SDK generateContentStream / Chat stream | Mevcut SSE event map, cancel ve replay | Google stream parser |
| Multi-turn | SDK Chat ve desteklenen history API | Context'ten başlatma, güvenli checkpoint | Yeni konuşma SDK'sı |
| Native AFC | Sabit sürümün desteklenen Chat/tool mekanizması | Yetkili tool callback bağlantısı | İkinci planner veya bağımsız agent framework |
| Manuel tool çağrısı | SDK Content/FunctionResponse tipleri | Mevcut Agent execution döngüsü | Yeni function-call protokolü |
| Google Search | Native built-in tool | Veri paylaşımı izni, kaynak UI | Arama motoru/crawler |
| URL Context | Native built-in tool | Onaylı URL ve erişim sonucu | Genel web scraper |
| Python hesaplama | Native code execution | Girdi referansı, sonuç doğrulama | Yeni sandbox kümesi |
| JSON | Native response schema | İş kuralları ve kaynak doğrulama | JSON'u prompt/regex ile onarma motoru |
| Medya | SDK Part/FileData ve native işleme | Yetkili dosya erişimi, source locator | Genel OCR/video parçalama sistemi |
| Artifact | Mevcut renderer/verifier/worker | Aynı analizden bundle ve revision bağlantısı | Gemini ile Office ZIP formatını üretme |
| Kalıcılık | Mevcut turn/job/outbox/lease | Gerekli state referansları | İkinci workflow altyapısı |

### 29.1 SDK/endpoint uyumluluk kararı

JavaScript SDK README'si AFC'nin sonraki ana sürümde doğrudan Models.generateContent/stream yerine Chats modülünden kullanılacağına ilişkin uyarı içeriyor. Bu nedenle “en yeni SDK'yı kur” teslim kriteri değildir.

Uygulama başlamadan tek uyumluluk kaydı hazırlanır:

- repository SHA ve deploy SHA,
- gerçek Deno/runtime sürümü,
- tam `@google/genai` sürümü ve lockfile,
- Developer API veya Enterprise/Vertex seçimi,
- API sürümü, bölge, model kimliği,
- streaming, AFC, custom tool hook, cancellation, multimodal response ve built-in tool kombinasyonları,
- her satır için `verified / unsupported / not_tested` ve test kanıtı.

Node desteği, Deno uyumluluğunun kanıtı sayılmaz. Notebook'taki Python paket sürümü TypeScript sürümüne çevrilmez. Kimlik doğrulama ve veri yerleşimi farklı API'ler arasında sessiz geçiş yapılmaz. Özellik SDK'da yoksa yalnız o özellik için belgelenmiş REST kaçış yolu değerlendirilir; bütün adaptör REST olarak yeniden yazılmaz.

## 30. Native AFC ve manuel kontrol karar tablosu

| İş türü | Tercih | Zorunlu kontrol | Kullanıcı deneyimi |
|---|---|---|---|
| Kısa, salt okunur kurumsal araştırma | Hook'ları doğrulanmış native AFC | Her kaynak erişiminde workspace yetkisi, tur/bütçe limiti | Araştırma adımları ve kaynaklı sonuç |
| Google Search / URL Context | Native built-in tool | Çağrı öncesi izin ve dışarı gönderilen içerik kontrolü | Web kaynaklı sonuç |
| Story taslağı / test listesi | Native structured output | Şema + domain validation | Düzenlenebilir taslak |
| Jira/SAP dış yazma | Mevcut Agent/Execution onay yolu | Hedef, işlem payload'ı, approval, idempotency | Önizleme → onay → gerçek sonuç |
| Çok dosyalı artifact | Mevcut durable artifact job | Kanıt, render, verify, persist | Dosya paketi kartı |
| Uzun medya işi | Mevcut job; worker içinde native SDK | Checkpoint, lease, maliyet ve iptal | Ekran kapansa da izlenebilir iş |
| SDK'da callback kontrolü eksik | Mevcut manuel Agent döngüsü | Aynı Execution kapıları | Aynı UI; yeni kullanıcı modu yok |

Native AFC ve manuel yol aynı turn içinde birbirinden bağımsız plan yapmaz. Native döngü seçilmişse Agent sınırları ve tool bağlarını kurar; model önerileri callback üzerinden yürür. Onay/durable sınırında döngü durur ve iş checkpoint edilir. Kontrol edilemeyen callback'i çalıştırıp sonradan audit etmek kabul edilmez.

Built-in Search ve code execution, JETWORK custom callback'i değildir. Her Google iç adımını yakalayabildiğimizi varsaymayız. Politika her adımda ayrı insan onayı istiyorsa o built-in açılmaz. Özel tool sonuçlarındaki kurumsal sırların web sorgusuna taşınmaması için hassas araştırma ile web araştırması ayrı, minimize edilmiş çağrılarda yapılabilir.

### 30.1 V2 mimarisiyle uyum

V2 §8.4 döngüyü Agent/Kernel sınırında tutar. Native SDK'nın mekanik döngüsünü bu sınırdan kullanmak hedeflenir; provider adaptörünün iş kararı sahibi olması hedeflenmez. SDK entegrasyonu karar/observation kayıtlarını veya yetkili Execution sınırını atlıyorsa mevcut mimariyle uyumlu kabul edilmez. Böyle bir değişiklik ayrı ADR ve mimari onayı gerektirir. Bu plan ana mimari belgesini sessizce geçersiz kılmaz.

## 31. Streaming, multi-turn ve async ayrıntıları

### 31.1 Streaming kabul sözleşmesi

1. Backend turn kimliğini oluşturur; UI bunu tek mesaj kimliğine bağlar.
2. SDK native stream iterator'ı tüketilir; görünür text, tool hazırlığı ve completion ayrılır.
3. Sadece public event'ler mevcut Gateway SSE üzerinden gönderilir.
4. Kaynak metadata'sı metinden sonra gelirse aynı mesajın citation alanı güncellenir; metin yeniden üretilmez.
5. Ağ kesilirse mevcut turn'e bağlanılır; sadece reconnect için yeni ücretli generation başlatılmaz.
6. Kullanıcı durdurduğunda provider çağrısına iptal aktarılır; destek yoksa yeni execution engellenir ve kalan işin durumu açıkça raporlanır.
7. Partial yanıt `completed` sayılmaz. Safety, token limit ve transport hatası ayrı bitiş nedenleridir.

TTFT, ilk durum event'i değil ilk görünür cevap tokenidir. Durum göstergesini hızlandırmak model TTFT iyileşmesi olarak raporlanmaz. Grounding kontrolü gerektiren yanıtta henüz doğrulanmamış iddialar kesin sonuç gibi stream edilmez; gerekli durumda ilgili cevap bölümü doğrulama sonrasına bırakılır.

### 31.2 Multi-turn yaşam döngüsü

- Kalıcı konuşma kaydı: JETWORK DB.
- Modele sunulan bağlam: recent + resolved state + ilgili memory/evidence.
- Aktif Gemini oturumu: native Chat; bütün geçmişi tekrar büyüten ikinci kayıt sistemi değil.
- Provider state: Chat content/signature/opaque video continuation; sunucuda tenant, conversation, model ve SDK sürümüne bağlı.
- Yeniden başlatma: sadece SDK'nın desteklediği history/export mekanizmasıyla hydrate; canlı Chat nesnesi JSON'a çevrilip saklanmaz.
- Provider değişimi: normal konuşma ve kaynaklar taşınır; Gemini opaque state diğer modele verilmez.
- State süresi dolması: aynı kaynaktan kontrollü yeniden başlatma; sınırsız reprocess yok.

Checkpoint kaydı şifreleme, erişim kontrolü ve retention politikasına tabidir. UI/loglara raw thought metni veya opaque token yazılmaz. Kullanıcı kaynak erişimini kaybettiğinde eski checkpoint'in bu kaynağı kullanmaya devam etmesi engellenir.

### 31.3 Async API ile durable job ayrımı

Python `client.aio` örneği bloklamayan çağrıyı gösterir; TypeScript'te Promise/await ve stream iterator kullanılır. Bunlar queue, crash recovery veya tamamlanma garantisi değildir.

İş, ölçülen çalışma süresi Edge deadline'ını aşabilecekse veya kullanıcı bağlantısından bağımsız devam etmesi gerekiyorsa mevcut durable job'a alınır. Sırf await kullanıldığı için job yaratılmaz. Worker içinde de aynı native SDK kullanılır.

Önerilen job durumları mevcut state machine'e eşlenir: queued, running, awaiting_approval, verifying, completed, failed, cancelled. Gerçek oran bilinmiyorsa sahte yüzde gösterilmez. Yeniden deneme aynı idempotency anahtarını ve tamamlanan output referanslarını kullanır; tamamlanan dış yazma tekrarlanmaz.

## 32. Multimodal tool response — öncelikli ürün paketi

Bu özellik yalnız kullanıcının dosya yüklemesi değildir: kurumsal kaynak aracı görseli kendisi bulur ve modelin incelemesine sunar.

**Senaryo:** “Teklif kaydındaki bu kontrol hangi ekranda ve hangi koşulda çalışıyor?”

1. Model mevcut enterprise research aracını seçer.
2. Araç, yetkili kaynaklar içinden method açıklaması ve ilgili ekran görselini bulur.
3. Sonuç, kısa metin + source/version ref + MIME doğrulanmış görsel part olarak SDK'ya verilir.
4. Gemini metin ve görseli birlikte inceler. Kaynakta görünmeyen alan adı/koşul uydurulmaz.
5. UI açıklama yanında “İlgili ekran” kartını açar; kaynak versiyonu ve varsa doğrulanmış bölge gösterilir.

**Önemli sınırlar:** SDK/API'nin gerçekten desteklediği modality ve URI erişimi kullanılır. JETWORK'ün imzalı URL'sinin Google tarafından okunabileceği varsayılmaz; gerekirse onaylı upload/file yolu seçilir. Model erişimiyle son kullanıcının preview yetkisi ayrı ayrı kontrol edilir. Dosya uzantısı ile MIME çelişirse çağrı yapılmaz.

Modelin yorumladığı görsel, UI'da gösterilen sürümle aynı content hash'e bağlıdır. Bounding box veya timestamp desteklenmiyorsa sahte locator yerine dosya düzeyi kaynak gösterilir. Görsel çıkarmak için bütün kurumsal arşiv Google'a gönderilmez; ilgili kaynaklar seçilir.

## 33. Structured output, system instructions ve parametreler

### 33.1 Structured output ürün şemaları

| Şema | Örnek alanlar | UI | Ek doğrulama |
|---|---|---|---|
| StoryDraft | title, description, acceptanceCriteria, openQuestions, sourceRefs | Story kartı ve düzenleme | Kabul kriterlerinin kaynak/istekle ilişkisi |
| TestCaseSet | preconditions, steps, expectedResult, requirementRefs | Test tablosu | Gereksinim kapsamı ve yinelenen testler |
| Comparison | columns, rows, cellSourceRefs, unknowns | Karşılaştırma tablosu | Kanıtsız hücrenin bilinmiyor olması |
| MeetingFindings | decisions, actions, owners, dueDates, locators | Karar/aksiyon kartları | Söylenmemiş sorumlu/tarih null |
| ArtifactDraft | sections, tables, evidenceSnapshotId | Belge önizlemesi | Mevcut artifact validator/verifier |

Python Pydantic modeli örnektir; JETWORK TypeScript'te mevcut validator/JSON schema altyapısı kullanılır. Format geçerli olması içerik doğruluğu değildir. Bozuk veya kesilmiş JSON tamamlanmış kart olarak gösterilmez. Gerekirse bütçe içinde sınırlı düzeltme çağrısı yapılır; başarısızlık kullanıcı girdisini silmez.

### 33.2 System instruction yönetimi

Tek versiyonlu temel instruction, workspace politikası ve görev için gerekli talimatlar mevcut prompt yönetiminden derlenir. Her katmana aynı uzun metin kopyalanmaz. Kaynak dosyadaki talimat system instruction'a yükseltilmez. Persona ve dil davranışı izin/yetkilendirme yerine geçmez. Yeni process veya Chat hydrate edildiğinde gerekli system instruction yeniden sağlanır; sağlayıcıda kendiliğinden sonsuza kadar kaldığı varsayılmaz.

### 33.3 Token, maliyet ve safety

- Native countTokens büyük/limit sınırındaki girdilerde preflight için kullanılır; her küçük mesaja ek ücretli round-trip eklenmez.
- computeTokens desteği endpoint bazında doğrulanır; production kritik yolu için zorunlu değildir.
- Faturalanan gerçek kullanım response usage üzerinden kaydedilir. Thinking/cached/media alanları varsa korunur; bulunmayan alan sıfır gerçek tüketim gibi sunulmaz.
- Birim token fiyatı ile başarılı işin toplam maliyeti ayrıdır. “Aynı fiyat sınıfı” toplam maliyetin aynı olacağını kanıtlamaz.
- Safety kategorileri model/endpoint desteğine göre allowlist edilir; notebook'taki tüm enum'lar körlemesine gönderilmez.
- Safety block, boş yanıt, token limit ve ağ hatası farklı kullanıcı mesajları ve metrikler üretir. Safety engeli sınırsız retry veya başka modelle aşılmaz.

## 34. UI/UX ayrıntılı davranış ve hata durumları

| Yüzey | Başarılı akış | Hata/belirsizlik | Kullanıcı kontrolü |
|---|---|---|---|
| Composer | Dosya/URL + amaç; Auto varsayılan | Desteksiz MIME/süre/limit çağrı öncesi görünür | Dosyayı kaldır, amacı değiştir |
| Çalışma göstergesi | Mevcut logo/animasyon + gerçek adımlar | Kaynak erişilemiyor / işlem kesildi | Durdur; uygun durumda yeniden dene |
| Kaynak kartı | Kaynak türü, sürüm, konum, alıntı | Kanıt yok veya çelişki var | Kaynağı aç; başka kaynak ekle |
| Structured kart | Düzenlenebilir story/test/karşılaştırma | Eksik alan açık konu olarak görünür | Düzelt, kabul et, dışa aktar |
| Multimodal kart | Görsel/PDF/ses/video önizlemesi | Süresi dolmuş bağlantı için yeniden yetkilendirme | Kaynak konumuna git |
| Onay kartı | Hedef ve değişiklik payload'ı | Yetki yoksa çalıştırma yok | Onayla / reddet; payload değişirse yeni onay |
| Job kartı | Durum ve doğrulanmış çıktılar | Kısmi çıktı, retryable/kalıcı hata ayrımı | İptal, kaldığı yerden dene |
| Teknik ayrıntı | Gerçek model, süre, çağrı sayısı | Ölçüm eksikse açık işaret | Yetkili kullanıcı trace referansını açar |

Google Search Suggestion HTML'i tüm uygulamanın DOM'una kontrolsüz yerleştirilmez. Resmi görünüm/tıklama şartlarını koruyan izole render yüzeyi ve güvenlik testi kullanılır. Provider HTML'i kaynak metniyle birleştirilmez.

Erişilebilirlik: Klavye ile kart/onay/kaynak işlemleri; ekran okuyucu için aşama değişiminde ölçülü aria-live; her token veya saniyede anons yok. Mobilde tablolar yatay kayabilir ve kaynaklar açılır panelde gösterilir. Mevcut JetWork animasyonu korunur; reduced-motion tercihi desteklenir. Bu çalışma genel tasarım yenilemesi değildir.

## 35. Teslim paketleri, bağımlılıklar ve kabul kanıtı

Bu paketler §22'deki G0–G8 işlerini kullanıcı değeri üzerinden gruplar; ayrı platform projeleri değildir. Uygulama aşağıdaki kullanıcı değeri taşıyan paketlerle teslim edilir.

| Paket | İşler | Mevcut dosya/modül hedefleri | Bağımlılık | Kabul kanıtı |
|---|---|---|---|---|
| A — Native temel | G0/G1/G2/G3; model doğrulama, SDK pin, stream, mod | platform/intelligence, model registry, CompactModelControl, ChatPanel | Doğru branch/SHA | Gerçek stream, iptal, 3 düşünme seviyesi ve tek model seçimi |
| B — Akıllı kaynaklı işler | G1/G3 + G5 web kısmı; tool bağlantıları, JSON, kaynak UI | platform/agent, Execution public contract, mevcut knowledge/web araçları, AssistantWorkIndicator | A; AFC uyumluluk sonucu | Kaynak arama → takip tool → kaynaklı cevap; aynı senaryo manuel fallback'te |
| C — Görsel kanıt | G4 + multimodal function response | Context attachments, knowledge kaynak ref, FileViewer, ChatPanel | B'nin source sözleşmesi | Kaynaktan görsel bul → model incele → aynı görseli kullanıcı aç |
| D — Hesaplama ve çıktı | G3/G4 compute + mevcut artifact bundle | Intelligence built-in tool, artifact renderer/verifier/worker | A/B; veri paylaşımı politikası | Doğru hesap + doğrulanmış dosya; kod hatası ayrı rapor |
| E — Uzun medya | G4/G6; native video + mevcut jobs | runtime-worker, Context state, media locator UI | C; durable checkpoint | Takip sorusu, worker restart, cancel ve timestamp doğruluğu |
| F — Kontrollü yaygınlaştırma | G8; golden suite/canary | QualityLabPage, evaluation, Telemetry, rollout config | Yayına açılacak paketin testleri | Exact SHA scorecard ve denenmiş rollback |

Modelin genel sohbet varsayılanı olması E paketinin bitmesini zorunlu kılmaz; doğrulanmış özelliklerle kapsamı sınırlı yayın yapılabilir. Ancak bunu “tüm entegrasyon tamamlandı” diye raporlamayız. Sonraki özellikler kendi flag ve kabul kapısıyla açılır.

Dosya hedefleri mevcut ağaca göre öneridir. Uygulayıcı yeni versiyon-wrapper dosyaları yaratmaz; aktif import yolunu doğrular ve ilgili mevcut modülü genişletir. Bu doküman dosya hedeflerindeki kodların değiştirildiğini belirtmez.

## 36. Genişletilmiş doğrulama senaryoları

| ID | Senaryo | Beklenen sonuç |
|---|---|---|
| N01 | Native AFC iki ardışık salt-okunur tool çağrısı | Her çağrıda yetki/bütçe kontrolü; tek semantik döngü |
| N02 | AFC sırasında izin iptali | İkinci tool çalışmaz; eski kaynak state'i sızıntı üretmez |
| N03 | SDK upgrade: Models → Chats AFC davranışı | Contract testi farkı yakalar; upgrade otomatik production'a gitmez |
| N04 | Çok büyük streamed tool argümanı | Tamamlanmadan execution yok; argüman UI/loga sızmaz |
| N05 | Chat instance kaybı | Desteklenen history ile restore; kullanıcı mesajı yinelenmez |
| N06 | Provider değişimi | Gemini opaque state diğer provider'a gönderilmez |
| N07 | Kurumsal tool görsel döndürür | Model ve UI aynı sürümü kullanır; MIME/hash uyumlu |
| N08 | Kaynak görseline yetki yok | Ne model ne kullanıcı yetkisiz dosyayı alır |
| N09 | Geçerli JSON, yanlış iş bilgisi | Domain/evidence kontrolü reddeder veya açık konu yapar |
| N10 | Google Search metadata geç gelir | Citation mevcut yanıta eklenir; duplicate cevap oluşmaz |
| N11 | Built-in search ile hassas bağlam | Dışarı çıkmasına izin verilmeyen veri sorguya taşınmaz |
| N12 | Native hesaplama başarısız | Başarılı sonuç iddiası yok; bounded recovery veya hata |
| N13 | Worker aynı işi iki kere teslim alır | Aynı dış yazma/çıktı tekrar üretilmez veya çifte publish edilmez |
| N14 | Video locator medya dışında | Kaynak referansı reddedilir; uydurma zaman kodu gösterilmez |
| N15 | Native tool kombinasyonu desteklenmiyor | Çağrı öncesi capability check; açık sınırlama, sessiz başka provider yok |
| N16 | Kullanıcı yalnız biçim revizyonu ister | İçerik ve evidence korunur; yeniden araştırma zorlanmaz |
| N17 | Yeni kaynak eski bulguyu değiştirir | Yeni immutable snapshot; eski çıktının kaynağı korunur |
| N18 | Native async çağrıda bağlantı kapanır | Job olmayan iş durable tamamlandı diye gösterilmez |
| N19 | Mobil/reduced-motion/klavye testi | İş durumu ve kontroller animasyondan bağımsız anlaşılır |
| N20 | Kaynakta cevap yok | Dürüst boşluk; yakın SAP kodundan uydurma cevap yok |

P7 ölçümlerinde Master Plan'daki on span adı aynen korunur: request_to_claim, claim_to_context, context_to_controller, capability_discovery_latency, controller_decision_latency, tool_latency, replan_latency, final_generation_ttft, stream_duration, total_turn. Native SDK iç adımı ölçülemiyorsa ölçüm yok olarak raporlanır; sıfır süre atanmaz.

Golden suite aynı input/source sürümleri, aynı SHA ve aynı kalite rubric'i ile karşılaştırılır. Önerilen ilk set: 10 kurumsal retrieval, 5 follow-up, 5 web/URL, 5 structured çıktı, 5 multimodal, 5 hesaplama/artifact, 5 hata/yetki senaryosu. Tekrarlı koşum sayısı ve örneklem büyüklüğü raporlanır; küçük örneklemden güvenilir P95 iddiası çıkarılmaz. Güvenlik invariant'ı ihlali veya yetkisiz yazma doğrudan durdurma nedenidir.

## 37. Uygulama öncesi açık kararlar ve doküman kabul listesi

| Açık konu | Varsayılan yaklaşım | Kapanış kanıtı |
|---|---|---|
| Etkin deploy hangi SHA'yı çalıştırıyor? | §2'deki mevcut 3.8 entegrasyonunu koru; tekrar ekleme | Çalışan deployment'ın model registry/runtime/SHA kanıtı |
| Hangi JS SDK sürümü? | Tam sürüm pin; sürüm yükseltmeyi ayrı tut | Deno ve AFC contract test raporu |
| Native AFC uygun mu? | Hook/iptal/bütçe sağlanırsa kullan | N01–N04 geçişi |
| Hangi Google endpoint/bölge? | Mevcut onaylı veri işleme konumu | Endpoint/auth/region kaydı |
| Multimodal tool dosyası nasıl taşınır? | Mevcut storage + desteklenen provider file yolu | Yetki, MIME ve erişim testi |
| Native video sınırları ve preview erişimi? | Ayrı flag; endpoint'e özgü doğrulama | Limit/continuation contract testleri |
| Hangi özellikler ilk yayında? | A+B; hazırsa C/D, E ayrı | Özellik bazında scorecard |

Bu revizyonun tamamlanma ölçütü doküman kapsamıdır: native yeniden kullanım kararları, SDK/endpoint belirsizlikleri, V2 sınırları, UI durumları, testler ve teslim bağımlılıkları tarif edildi. Uygulamanın tamamlanma ölçütü ise §25 ve §40'tır; doküman güncellemesi kod/test/deploy tamamlandı anlamına gelmez.

## 38. Kesin sorumluluk kararı: Gemini düşünür ve karar verir

Bu bölümdeki kararlar Revizyon 3'ün bağlayıcı ürün niyetidir. “Agent”, ayrı bir LLM planner veya Gemini'yi anahtar kelimelerle yöneten deterministik beyin anlamına gelmez. JETWORK Agent, Gemini'nin araçları ve bağlamı kullanarak çalıştığı uygulama katmanıdır. Bu karar Gemini yolu için geçerlidir; kullanıcının açık başka provider seçimini geçersiz kılmaz.

| Karar / sorumluluk | Sahibi | Uygulama sınırı |
|---|---|---|
| Kullanıcı ne istiyor? | Gemini | Talep/context üzerinden anlamlandırma |
| Hangi araca/kaynağa ihtiyaç var? | Gemini | Yetkili adaylar arasından seçim; keyword zorlaması yok |
| Sonraki adım ne, plan değişmeli mi? | Gemini | Tool sonuçlarına göre re-plan |
| Kaynaklar yeterli mi, eksik soru sorulmalı mı? | Gemini | Kanıt ve validation observation'ları üzerinden karar |
| Kullanıcıya ne zaman, ne anlatılmalı? | Gemini | Public iletişim talimatları ve gerçek bulgular içinde |
| Final yanıt veya artifact talebi | Gemini | İşin gerçekte tamamlandığına ilişkin sistem kayıtlarıyla sınırlı |
| Kaynağa/işleme erişim yetkisi | Sunucu politikası | Model izin yaratamaz veya yükseltemez |
| Riskli dış değişikliğin onayı | Kullanıcı / yetkili onay akışı | Tam hedef ve payload onayı |
| Şema, deadline, bütçe, tekrar çalıştırma kontrolü | Yürütme altyapısı | Mekanik kontrol; semantik plan üretmez |
| Kalıcı state, resume, output verification | Hazır veya mevcut workflow/artifact altyapısı | Kayıtlı ve test edilebilir garanti |

Evidence kontrolü kaynak referansı, şema, sürüm veya kanıt eksikliği observation'ı üretir. Bu bir ret ise sistem işlemi durdurabilir; hangi yeni kaynağın aranacağına veya kullanıcıya hangi açıklamanın yapılacağına Gemini karar verir. Yetki reddi model tarafından aşılamaz.

Her kullanıcı isteğinin önce başka bir planner'a, ardından Gemini'ye aynı işi planlatmak için gönderilmesi yasaktır. Kurumsal kimlik eşleştirmesi retrieval içinde veri işlemi olabilir; “faturadar geçiyorsa şu tool zorunlu” gibi konuşma seviyesinde semantik yönlendirme değildir. Native AFC veya mevcut manuel loop seçimi kullanıcı niyetini yeniden yorumlayan ikinci beyin kurmaz.

## 39. Public çalışma iletişimi: ara mesajlı asistan deneyimi

### 39.1 Amaç ve içerik ayrımı

Hedef, kullanıcının iş boyunca asistanla iletişimde kalmasıdır. Sadece dönen logo, “Düşünüyor” veya tool adı listesi yeterli değildir. Asistan gerektiğinde kısa mesaj atar, ne yaptığını ve bunun kullanıcı açısından anlamını açıklar; en sonunda kendi başına anlaşılır final yanıtı verir.

| İçerik | Örnek | Gösterim / saklama |
|---|---|---|
| Başlangıç niyeti | “Önce ilgili methodu bulacağım; sonra ürettiği mesajları inceleyeceğim.” | Public commentary; konuşmada saklanır |
| Ara bulgu | “Methodu buldum; bağlı mesajların bir bölümü başka kaynakta. Onları da inceliyorum.” | Gerçek observation'a dayanır; public commentary |
| Kısa karar açıklaması | “Kaynaklar farklı sürümlere ait; sonucu sürüm bazında ayıracağım.” | Public gerekçe özeti; ham düşünce zinciri değil |
| Engel / sınır | “Bu kaynağa erişim iznim yok. Erişebildiğim kaynaklarla devam edebilirim.” | Public commentary veya kullanıcı girdisi isteği |
| Sistem durumu | “İş kuyrukta; henüz başlamadı.” | Runtime tarafından açıkça sistem durumu olarak |
| Final yanıt | Bulgular, kaynaklar, açık konular ve varsa dosyalar | Ayrı final mesaj |
| Ham özel reasoning / signature | İç muhakeme tokenleri veya opaque provider state | Kullanıcı iletişim kanalı değildir; UI/log dışında |

Özel reasoning'i göstermeme kuralı, kullanıcıya gerekçe veya çalışma açıklaması vermeme anlamına gelmez. “Ne yapıyorum / ne buldum / neden yaklaşımı değiştirdim / ne eksik?” soruları kısa ve anlaşılır biçimde yanıtlanır. Gizli düşünce zinciri dökümü istenmez. Kaynakla desteklenmeyen ara bulgu yayımlanmaz; belirsiz bulgu açıkça geçici olarak belirtilir.

### 39.2 Mesaj zamanlaması

- Basit selamlaşma veya tek adımlı kısa cevapta gereksiz başlangıç mesajı yok; doğrudan final.
- Araç veya uzun iş başlamadan önce, uygunsa bir kısa başlangıç mesajı.
- Anlamlı yeni bulgu, yaklaşım değişikliği, kullanıcı kararı veya engel oluştuğunda kısa ara mesaj.
- Her tool çağrısı için otomatik aynı cümle üretilmez; kullanıcıyı ilgilendiren değişim esas alınır.
- Uzun sessizlikte runtime gerçek bekleme durumunu gösterebilir. Bu Gemini'nin düşüncesiymiş gibi yazılmaz; sahte bulgu veya yüzde eklenmez.
- Önerilen gözlemlenebilirlik hedefi: uzun işlerde 30–60 saniyeyi aşan sessizlik izlenir. Bu, her 30 saniyede ayrı LLM çağrısı veya zorunlu metin üretme zamanlayıcısı değildir.
- Ara mesaj 1–3 kısa cümle olmalı; tüm plan veya geçmiş her seferinde tekrarlanmamalı.
- Final yanıt ara mesajlar okunmadan anlaşılmalı; ancak gereksiz işlem günlüğüne dönüşmemeli.

### 39.3 Üretim ve taşıma

Native SDK seçilen sürümde pre-tool public text/status kanalını güvenilir biçimde destekliyorsa doğrudan o yol kullanılır. Desteklemiyorsa Agent'e ince bir `report_progress` aracı sunulması önerilir. Bu isim JETWORK sözleşmesi önerisidir, Google'ın hazır API alanı değildir.

Önerilen giriş: `kind: start | finding | plan_change | blocked`, kısa `message`, varsa `sourceRefs`. Bu araç yalnız public event kaydeder; veri sorgulamaz, dış sistem değiştirmez, izin vermez ve ikinci LLM çağrısı yapmaz. Execution zamanlaması veya SDK tur sınırı maliyeti contract testte ölçülür. Yalnız UI'ı konuşturmak için ayrı narrator modeli kurulmaz.

Modelin “bulundu/tamamlandı” gibi ifadeleri ilgili execution sonucundan sonra gelmelidir. Denetim ikinci serbest metin planner ile değil, id/ref/state doğrulamasıyla yapılır. Sonuç iddiası henüz kanıtlanamıyorsa finalleştirilmez; Gemini'ye observation döner.

Önerilen public taşıma sözleşmesi mevcut event tipleriyle birleştirilir:

```ts
type AssistantPublicUpdate = {
  runId: string
  turnId: string
  messageId: string
  sequence: number
  kind: 'start' | 'finding' | 'plan_change' | 'blocked'
  text: string
  sourceRefs?: string[]
  createdAt: string
}
```

Sözleşme `assistant.commentary` olarak veya eşdeğer mevcut event ile taşınabilir. Final delta'ları ayrı messageId/type altında kalır. Native SDK text'inin public commentary mi final mi olduğu belirlenemiyorsa içerik regex'le tahmin edilmez; açık status aracı veya desteklenen typed kanal tercih edilir.

### 39.4 UI ve kalıcılık

- Ara mesajlar sohbet akışında JetWork AI kimliğiyle, sade ve okunabilir görünür. Teknik debug modalına saklanmaz.
- Gerçek tool durumları mevcut AssistantWorkIndicator içinde kalabilir; aynı açıklama iki yerde tekrar edilmez.
- Final geldiğinde ara mesajlar silinmez; isteğe bağlı “Çalışma sırasında” grubunda daraltılabilir. Final baskın görünür.
- Public mesajlar sequence/messageId üzerinden deduplicate edilir ve yeniden bağlanmada sırası korunur.
- Kullanıcı durdurduğunda önceki ara mesajlar korunur; final yoksa tamamlandı görünümü verilmez.
- UI erken mesajı final yanıt olarak DB'ye yazmaz. Run tamamlanması ile ara mesaj gönderilmesi farklı olaylardır.
- Ara mesajlar aynı konuşmanın erişim/retention politikasına tabidir. Secrets, erişilemeyen kaynak adları veya başka tenant bilgisi içermez.
- Onay gerektiğinde yalnız ara mesaj atıp beklenmez; açık, etkileşimli approval/input durumu oluşturulur.

### 39.5 Örnek uçtan uca konuşma

**Kullanıcı:** “Bu methodun ürettiği mesajları bul, ardından test senaryolarını çıkar.”

**Başlangıç:** “Önce methodun kaynak kodunu ve bağlı mesajları inceleyeceğim. Testleri bulduğum koşullara göre hazırlayacağım.”

**Ara bulgu — yalnız tool sonucu geldikten sonra:** “Method bulundu, ancak mesaj açıklamalarının bir kısmı referans verilen katalogda. Kataloğu da kontrol ediyorum.”

**Yaklaşım değişikliği — gerçekten çelişki varsa:** “Kod ile açıklama dokümanı farklı sürümlere ait. Doğrulanmış davranışı ve açık kalan farkı ayrı göstereceğim.”

**Final:** Kaynaklarla eşlenmiş mesajlar, test adımları/beklenen sonuçlar ve doğrulanamayan noktalar. Dosya istenmişse ancak render/verify/persist sonrasında indirme kartı.

Bu cümleler örneklerdir; üretimde sabit sırayla oynatılan senaryo metni değildir. Hangi adımın gerekli olduğuna ve hangi public açıklamanın anlamlı olduğuna Gemini karar verir.

## 40. Revizyon 3 teslim ve kabul kriterleri

Paket A'ya public message taşıma/kalıcılık, Paket B'ye Gemini kaynaklı ara açıklamalar eklenir. Ayrı platform, ikinci planner veya narrator servisi kurulmaz.

| Test | Beklenen kanıt |
|---|---|
| R31-01 — Basit mesaj | Gereksiz plan/ara mesaj olmadan doğal final |
| R31-02 — Çok adımlı araştırma | Başlangıç + gerçek bulgu/plan değişikliği + bağımsız anlaşılır final |
| R31-03 — Karar sahipliği | Tool seçimi Gemini çıktısına dayanır; başka planner/keyword yönlendirmesi yok |
| R31-04 — Execution reddi | Yetkisiz işlem çalışmaz; Gemini reddi açıklayıp izinli sonraki adımı seçer |
| R31-05 — Commentary/final ayrımı | Ara mesaj final delta'larına karışmaz ve turn'ü tamamlamaz |
| R31-06 — Reload/reconnect | Public ara mesajlar sıralı, eksiksiz ve tekrarsız geri gelir |
| R31-07 — Durdurma | Önceki mesajlar korunur; sonraki execution durur; sahte tamamlanma yok |
| R31-08 — Reasoning ayrımı | Kullanıcıya kısa gerekçe görünür; raw thought/signature sızmaz |
| R31-09 — Uzun bekleme | Gerçek sistem durumu gösterilir; zamanlayıcı uydurma model mesajı üretmez |
| R31-10 — Maliyet | Commentary için ayrı narrator çağrısı yok; varsa status tool tur maliyeti raporlanır |
| R31-11 — Eksik kanıt | Ara/final mesaj bilinmeyeni açıkça belirtir; kaynak/işlem uydurmaz |
| R31-12 — Yeni kullanıcı girdisi | Mevcut konuşma sırası korunur; eski plan yeni talebe rağmen körlemesine devam etmez |

İletişim gecikmesi ayrıca ölçülür: ilk public update süresi ve anlamlı güncellemeler arasındaki bekleme. Bunlar P7 `final_generation_ttft` yerine kullanılamaz. Başarı, yalnız daha sık mesaj göstermek değil; doğru karar, anlaşılır iletişim, kaynak doğruluğu ve tamamlanan iştir.
