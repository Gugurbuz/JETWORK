# Sprint 1 — Repo Teknik Envanter Raporu

Bu rapor, Jetwork uygulamasının mevcut kod yapısına bakılarak AI iş analizi ve kavramsal tasarım üretim motoruna dönüştürülmesi için hazırlanmıştır.

## 1. Mevcut Teknoloji Envanteri

| Alan | Mevcut Durum | Sprint 1 Etkisi |
|---|---|---|
| Frontend | React 19 + Vite | Yeni analiz modülü mevcut frontend mimarisine paralel eklenebilir. |
| State | Zustand store yapısı | ConceptualDesignDocument ileride ayrı store veya document store uzantısı olarak bağlanabilir. |
| AI Servis | Supabase Edge Function üzerinden Gemini çağrısı | generateConceptualDesign aynı servis katmanını kullanır. |
| Şema Doğrulama | Zod + zod-to-json-schema | ConceptualDesignDocument için Zod şeması eklendi. |
| Doküman İşleme | marked, mammoth, Tiptap | Word export ve şablon okuma için sonraki sprintlerde genişletilebilir. |
| BPMN | bpmn-js ve mermaid bağımlılıkları mevcut | BPMN XML üretimi Sprint 3 için hazır altyapıya bağlanabilir. |

## 2. İncelenen Ana Dosyalar

| Dosya | Mevcut Görev | Tespit | Önerilen Aksiyon |
|---|---|---|---|
| `package.json` | Bağımlılık ve script yönetimi | AI, BPMN, doküman ve şema üretimi için gerekli temel paketler mevcut. | Sprint 1 için yeni bağımlılık gerekmiyor. |
| `src/types.ts` | Uygulama temel veri tipleri | `DocumentData` genel BA/Code/Test/BPMN bölümlerinden oluşuyor. Kavramsal tasarım için yeterince yapısal değil. | Yeni ConceptualDesignDocument modeli ayrı modül olarak eklendi. |
| `src/schemas.ts` | Mevcut Zod ve Gemini response şemaları | Mevcut şema genel chat ve doküman üretimi için tasarlanmış. | Yeni şema mevcut dosyayı bozmadan ayrı dosyada eklendi. |
| `src/hooks/useMessages.ts` | Chat, attachment, AI çağrısı ve doküman üretimi | `handleGenerateDocument` sohbet geçmişinden genel JSON dokümanı üretiyor. | Sprint 2'de ayrı kavramsal tasarım üretim aksiyonu bağlanmalı. |
| `src/services/geminiService.ts` | Supabase function üzerinden Gemini stream çağrısı | `responseSchema`, attachment ve streaming destekleniyor. | generateConceptualDesign bu servisle uyumlu yazıldı. |
| `src/services/promptEngine.ts` | Sistem prompt ve BA doküman şablonu | Mevcut BA şablonu genel iş analizi formatında. | Kavramsal tasarım için ayrı prompt builder eklendi. |
| `src/constants.ts` | Ajan persona ve sistem talimatları | PO, BA, IT, QA, UI/UX, SM ve Orchestrator rolleri tanımlı. | İleride conceptual design pipeline bu ajan rollerine bölünebilir. |
| `src/utils/documentUtils.ts` | Doküman kaydetme, versiyonlama ve patch işlemleri | Mevcut DocumentData üzerinde çalışıyor. | Sprint 4'te Word export ve ConceptualDesignDocument versiyonlama genişletilmeli. |

## 3. Mevcut Mimari Akış

```text
Kullanıcı mesajı / ek dosya
→ useMessages.handleSendMessage
→ runSingleChatOrchestrator veya runZeroTouchMode
→ geminiService.callGemini
→ ChatResponse / DocumentData
→ useStore.setDocumentContent
→ saveDocumentAndVersion
```

Sprint 1 kapsamında yeni motor aşağıdaki şekilde paralel eklenmiştir:

```text
GenerateConceptualDesignInput
→ conceptualDesignPrompt
→ geminiService.callGemini
→ ConceptualDesignDocumentSchema
→ runConceptualDesignQualityCheck
→ GenerateConceptualDesignResult
```

## 4. Sprint 1 İçin Eklenen Modül

Yeni klasör:

```text
src/modules/conceptual-design/
```

Eklenen dosyalar:

| Dosya | Amaç |
|---|---|
| `conceptualDesignTypes.ts` | Kavramsal tasarım dokümanı için TypeScript veri modeli. |
| `conceptualDesignSchemas.ts` | Modelin Zod şemaları ve JSON schema çıktısı. |
| `conceptualDesignPrompt.ts` | AI üretimi için sistem ve kullanıcı prompt builder. |
| `conceptualDesignGenerator.ts` | Gemini çağrısı, JSON parse, schema validation ve kalite kontrol akışı. |
| `qualityChecker.ts` | Başlangıç kalite kontrol motoru. |

## 5. Tasarım Kararları

### 5.1. Mevcut `DocumentData` bozulmadı

Mevcut uygulama BA/Code/Test/BPMN doküman akışını kullanıyor. Bu nedenle Sprint 1'de `DocumentData` doğrudan değiştirilmedi. Yeni kavramsal tasarım modeli ayrı modül olarak eklendi.

### 5.2. AI çıktısı yapısal JSON olmalı

Kavramsal tasarım dokümanında tekrar eden başlıklar, hatalı numaralandırma ve dağınık KPI problemini önlemek için AI çıktısı markdown yerine `ConceptualDesignDocument` JSON modeli olarak tasarlandı.

### 5.3. P0-P8 sabit ürün kuralı yapılmadı

Talep kapsamında P0-P8 örnek süreç seti var; ancak ürün ileride P9, P10 veya farklı süreçler desteklemeli. Bu yüzden süreç kodu opsiyonel `process.code` alanında tutuldu.

### 5.4. Kalite kontrol export öncesi zorunlu katman olmalı

Başlık, gereksinim, KPI, mesaj, doküman, entegrasyon ve izlenebilirlik kontrolleri doküman export öncesinde kalite raporuna dönüştürülmelidir.

## 6. Sprint 2'ye Devreden Teknik İşler

| İş | Açıklama |
|---|---|
| UI bağlantısı | Kavramsal tasarım üretimi için ayrı ekran/aksiyon eklenmeli. |
| Store entegrasyonu | ConceptualDesignDocument için Zustand state veya document store uzantısı yapılmalı. |
| Supabase kayıt modeli | Yeni doküman tipinin versiyonlanması için tablo/kolon stratejisi netleşmeli. |
| Process extraction | Talep dokümanı ve ekran görüntüsünden süreç modelleri daha kontrollü çıkarılmalı. |
| Requirement normalizer | BR/FR/NFR/UI/INT/DOC kodlama standardı otomatik normalize edilmeli. |
| BPMN üretimi | ProcessModel.flowSteps alanından BPMN XML üretimi eklenmeli. |
| Word export | Enerjisa kavramsal tasarım şablonuna uygun .docx üretimi eklenmeli. |

## 7. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| AI JSON çıktısı bozuk dönebilir | Üretim başarısız olur | Zod doğrulama ve parse hata yönetimi eklendi; Sprint 2'de retry/repair prompt eklenmeli. |
| Mevcut DocumentData ile yeni model karışabilir | UI karmaşası oluşur | Modül ayrı tutuldu; bağlantı aşamasında explicit document type kullanılmalı. |
| Büyük ek dosyalar token limitini aşabilir | Analiz eksik kalabilir | Attachment özetleme ve chunking Sprint 2 kapsamına alınmalı. |
| Word export şablonu bozulabilir | Doküman formatı kabul görmez | Export motoru şablon tabanlı ve testli geliştirilmeli. |

## 8. Sprint 1 Durumu

| Teslimat | Durum |
|---|---|
| Repo teknik envanter raporu | Tamamlandı |
| ConceptualDesignDocument veri modeli | Tamamlandı |
| Zod şemaları | Tamamlandı |
| AI prompt iskeleti | Tamamlandı |
| generateConceptualDesign fonksiyonu | Tamamlandı |
| Quality checker başlangıç versiyonu | Tamamlandı |
