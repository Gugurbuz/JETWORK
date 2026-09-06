# JETWORK · Gemini 3.8 Flash Product & Architecture Plan

**Belge türü:** Ürün + UX/UI + Runtime + Mimari Uygulama Planı  
**Tarih:** 06.09.2026  
**Durum:** Uygulama planı / production hardening  
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

Controller serbest metin ile “sanırım tool çağırmalıyım” demek yerine valid JSON contract döndürmelidir.

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

Gösterilecek yapılandırılmış status örnekleri:

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
- [ ] Gemini response schema ile enforce et.
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
- [ ] Structured status feed.
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
- [ ] Status messages structured.
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
