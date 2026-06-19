import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Type } from "@google/genai";

// Form Input Şemaları (client-side validation)
export const NewProjectInputSchema = z.object({
  name: z.string().trim().min(2, "Proje adı en az 2 karakter olmalıdır.").max(100, "Proje adı en fazla 100 karakter olabilir."),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir.").optional().default(""),
});

export const EditWorkspaceInputSchema = z.object({
  title: z.string().trim().min(2, "Çalışma alanı adı en az 2 karakter olmalıdır.").max(120, "Çalışma alanı adı en fazla 120 karakter olabilir."),
});

export const OnboardingInputSchema = z.object({
  username: z.string().trim().min(3, "Kullanıcı adı en az 3 karakter olmalıdır.").max(32, "Kullanıcı adı en fazla 32 karakter olabilir.").regex(/^[a-zA-Z0-9._-]+$/, "Kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir."),
  firstName: z.string().trim().min(1, "Ad alanı zorunludur.").max(50, "Ad en fazla 50 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyad alanı zorunludur.").max(50, "Soyad en fazla 50 karakter olabilir."),
  role: z.string().trim().min(1, "Rol seçimi zorunludur."),
});

// YENİ EKLENEN: Bölüm (Section) Şeması
export const SectionDataSchema = z.object({
  content: z.string().describe("Markdown formatında içerik metni."),
  status: z.enum(['DRAFT', 'NEEDS_REVISION', 'APPROVED']).describe("Bu bölümün güncel durumu."),
  flags: z.array(z.string()).describe("Diğer ajanların bu bölüme yaptığı itirazlar ve hata bildirimleri.")
});

// GÜNCELLENEN: DocumentData artık SectionData kullanıyor
export const DocumentDataSchema = z.object({
  businessAnalysis: SectionDataSchema.describe("İş analizi, gereksinimler ve projenin genel tanımı."),
  code: SectionDataSchema.describe("Teknik notlar, mimari kararlar, veritabanı şemaları veya örnek kod blokları."),
  test: SectionDataSchema.describe("Test senaryoları, kabul kriterleri ve QA adımları."),
  bpmn: SectionDataSchema.optional().describe("Geçerli bir BPMN 2.0 XML kodu."),
  review: SectionDataSchema.optional().describe("Toplantı notları, kararlar ve özetler."),
});

// 2. Görev/Hata Çıkarım Şeması (Task Extraction)
export const TaskExtractionSchema = z.object({
  title: z.string().describe("Görev veya hatanın kısa ve açıklayıcı başlığı."),
  description: z.string().describe("Görev veya hatanın detaylı açıklaması."),
  type: z.enum(["Bug", "Feature", "Improvement", "Task"]).describe("Kaydın türü."),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).describe("Öncelik durumu."),
  assignee: z.string().optional().describe("Eğer konuşmada belirtilmişse, görevin atanacağı kişinin adı."),
  estimatedHours: z.number().optional().describe("Eğer belirtilmişse tahmini efor (saat cinsinden).")
});

// 3. Geri Bildirim/Duygu Analizi Şeması (Feedback/Sentiment)
export const FeedbackSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Metnin genel duygu durumu."),
  summary: z.string().describe("Kullanıcının geri bildiriminin veya mesajının kısa özeti."),
  actionItems: z.array(z.string()).describe("Eğer varsa, metinden çıkarılan aksiyon adımları.")
});

// JSON Schema Dönüşümleri
export const documentDataJsonSchema = zodToJsonSchema(DocumentDataSchema, "DocumentData");
export const taskExtractionJsonSchema = zodToJsonSchema(TaskExtractionSchema, "TaskExtraction");
export const feedbackJsonSchema = zodToJsonSchema(FeedbackSchema, "Feedback");

// 4. Chat Response Schema (Ajanların Normal İletişim Şeması)
export const ChatResponseSchema = z.object({
  thinking: z.string().optional().describe("Ajanın adım adım düşünce süreci. Kullanıcıya gösterilecek olan iç sesin. Karar vermeden önce burada düşün."),
  message: z.string().describe("Kullanıcıya veya ekibe sohbette gösterilecek yanıt metni. Markdown formatında olabilir."),
  actionSummary: z.string().optional().describe("Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti."),
  score: z.number().optional().describe("Zero-Touch Mode için ajanın verdiği puan (0-100)."),
  scoreExplanation: z.string().optional().describe("Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin kısa özeti."),
  needsRevision: z.array(z.string()).optional().describe("Eğer revize edilmesi gerekiyorsa, ajanların rollerini (BA, IT, QA) buraya ekle."),
  updatedMemory: z.record(z.string(), z.string()).optional().describe("Proje kararları veya yeni kısıtlamalar (Örn: {'Platform': 'Web'})."),
  questions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    options: z.array(z.string())
  })).optional().describe("Kullanıcıya sorulacak sorular ve olası cevap seçenekleri."),
  document: DocumentDataSchema.optional().describe("SADECE EĞER ARAÇ (TOOL) KULLANAMIYORSAN BU ALANI DOLDUR. Eğer 'apply_micro_edit' aracına sahipsen bu alanı KESİNLİKLE BOŞ BIRAK.")
});

export const applyMicroEditTool = {
  functionDeclarations: [
    {
      name: "apply_micro_edit",
      description: "Dokümanın belirli bir sekmesindeki mevcut bir metni yenisiyle değiştirir. Dokümanı güncellemek için SADECE bu aracı kullanmalısın.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          section: {
            type: Type.STRING,
            description: "Güncellenecek doküman sekmesi",
            enum: ["businessAnalysis", "code", "test", "review", "bpmn"]
          },
          targetText: {
            type: Type.STRING,
            description: "Değiştirilecek cümlenin veya paragrafın dokümandaki birebir, harfi harfine mevcut hali. Eğer yeni bir metin ekliyorsan, eklenecek yerin hemen öncesindeki metni yaz."
          },
          replacementText: {
            type: Type.STRING,
            description: "Hedef metnin yerine geçecek yeni metin. Eğer sadece ekleme yapıyorsan, targetText + yeni metin şeklinde yaz."
          },
          explanation: {
            type: Type.STRING,
            description: "Chat ekranında kullanıcıya gösterilecek kısa özet (Örn: 'Kredi kartı modülünü IT mimarisine ekledim')."
          }
        },
        required: ["section", "targetText", "replacementText", "explanation"]
      }
    }
  ]
};

// Sabit şema tanımlaması
const sectionDataJsonType = {
  type: Type.OBJECT,
  properties: {
    content: { type: Type.STRING },
    status: { type: Type.STRING },
    flags: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
};

export const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    thinking: {
      type: Type.STRING,
      description: "Adım adım düşünme sürecin. Karar vermeden önce burada sesli düşün."
    },
    message: {
      type: Type.STRING,
      description: "Kullanıcıya veya ekibe sohbette gösterilecek yanıt metni. Markdown formatında olabilir."
    },
    actionSummary: {
      type: Type.STRING,
      description: "Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti."
    },
    score: {
      type: Type.NUMBER,
      description: "Zero-Touch Mode için ajanın verdiği puan (0-100). Sadece bu modda doldurulmalıdır."
    },
    scoreExplanation: {
      type: Type.STRING,
      description: "Verilen puanın detayı. Sadece Moderatör tarafından doldurulur."
    },
    needsRevision: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Eğer revize edilmesi gerekiyorsa, revizyon yapması gereken ajanların rollerini (BA, IT, QA) bu diziye ekle."
    },
    updatedMemory: {
      type: Type.OBJECT,
      description: "Kullanıcının mesajından çıkarılan yeni proje kararları, kısıtlamaları veya hedefleri (Örn: {'Platform': 'Web', 'Hedef Kitle': 'Şirket İçi'}). Sadece yeni veya değişen bilgileri ekle.",
      additionalProperties: { type: Type.STRING }
    },
    questions: {
      type: Type.ARRAY,
      description: "Kullanıcıya sorulacak sorular ve olası cevap seçenekleri. Eğer kullanıcıdan netleştirme isteniyorsa bu alanı kullan.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Soru için benzersiz bir ID (örn: q1, q2)" },
          text: { type: Type.STRING, description: "Sorunun metni" },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Kullanıcının seçebileceği olası cevap seçenekleri"
          }
        },
        required: ["id", "text", "options"]
      }
    },
    document: {
      type: Type.OBJECT,
      description: "Sağ paneldeki Çalışma Dokümanı. Araştırma ve analiz yeterliyse bu alanı TAM olarak doldur (mevcut doküman varsa koruyup genişleterek).",
      properties: {
        businessAnalysis: sectionDataJsonType,
        code: sectionDataJsonType,
        test: sectionDataJsonType,
        bpmn: sectionDataJsonType,
        review: sectionDataJsonType
      }
    }
  },
  required: ["message"]
};

export type ZodChatResponse = z.infer<typeof ChatResponseSchema>;

// ============================================================================
// 5. YENİ MİMARİ: OTONOM AJAN ARAÇLARI (AGENT TOOLS - FUNCTION CALLING)
// Ajanların dünyayla ve dokümanla etkileşime geçeceği fonksiyon tanımlamaları.
// ============================================================================
export const agentTools: any[] = [
  {
    functionDeclarations: [
      {
        name: "apply_micro_edit",
        description: "Dokümanın belirli bir sekmesindeki mevcut bir metni yenisiyle değiştirir. Dokümanı güncellemek için SADECE bu aracı kullanmalısın.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "Güncellenecek doküman sekmesi",
              enum: ["businessAnalysis", "code", "test", "review", "bpmn"]
            },
            targetText: {
              type: Type.STRING,
              description: "Değiştirilecek cümlenin veya paragrafın dokümandaki birebir, harfi harfine mevcut hali. Eğer yeni bir metin ekliyorsan, eklenecek yerin hemen öncesindeki metni yaz."
            },
            replacementText: {
              type: Type.STRING,
              description: "Hedef metnin yerine geçecek yeni metin. Eğer sadece ekleme yapıyorsan, targetText + yeni metin şeklinde yaz."
            },
            explanation: {
              type: Type.STRING,
              description: "Chat ekranında kullanıcıya gösterilecek kısa özet (Örn: 'Kredi kartı modülünü IT mimarisine ekledim')."
            }
          },
          required: ["section", "targetText", "replacementText", "explanation"]
        }
      },
      {
        name: "flag_issue",
        description: "KRİTİK: Başka bir ajanın (veya kendi) yazdığı bölümde mantıksal bir hata, güvenlik açığı, eksik bir test veya hatalı bir mimari kararı bulduğunda kullanılır. Bu araç o bölümün statüsünü 'NEEDS_REVISION' yapar ve hatayı listeye ekler.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "Hata bulunan doküman sekmesi (Örn: QA ajanı koddaki hatayı bulduysa 'code' seçer)",
              enum: ["businessAnalysis", "code", "test", "review", "bpmn"]
            },
            reason: {
              type: Type.STRING,
              description: "Hatayı veya eksikliği detaylıca açıklayan, karşı tarafın neyi düzeltmesi gerektiğini söyleyen itiraz metni."
            }
          },
          required: ["section", "reason"]
        }
      },
      {
        name: "update_document_status",
        description: "Bir bölümün statüsünü güncellemek için kullanılır. Kendi bölümünü yazmayı bitirdiğinde 'APPROVED' yapabilir veya revizyon sonrası onay verebilirsin.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "Statüsü değişecek bölüm",
              enum: ["businessAnalysis", "code", "test", "review", "bpmn"]
            },
            status: {
              type: Type.STRING,
              description: "Yeni statü",
              enum: ["DRAFT", "NEEDS_REVISION", "APPROVED"]
            }
          },
          required: ["section", "status"]
        }
      },
      {
        name: "ask_to_human",
        description: "Sistemde eksik olan, belirsiz olan veya şirkete özel olan (Legacy sistemler, kısıtlar, iş hedefleri) konularda varsayım yapmak (halüsinasyon) yerine doğrudan insana (kullanıcıya) soru sormak ve süreci bekletmek için kullanılır.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            question: {
              type: Type.STRING,
              description: "Kullanıcıya sorulacak detaylı soru metni."
            },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Kullanıcının seçebileceği veya ilham alabileceği muhtemel kısa cevap seçenekleri. (Örn: ['Evet, entegre', 'Hayır, izole', 'Bilinmiyor'])"
            }
          },
          required: ["question", "options"]
        }
      }
    ]
  }
];

// Moderatör (Orchestrator) için karar şeması
export const discussionJsonSchema = {
  type: Type.OBJECT,
  properties: {
    thinking: { type: Type.STRING, description: "Adım adım düşünme sürecin. Karar vermeden önce burada sesli düşün." },
    agentRole: { type: Type.STRING },
    message: { type: Type.STRING },
    actionSummary: { type: Type.STRING },
    isDocumentationPhase: { type: Type.BOOLEAN },
    requiresUserInput: { type: Type.BOOLEAN },
    questions: {
      type: Type.ARRAY,
      description: "Kullanıcıya sorulacak sorular ve olası cevap seçenekleri. Eğer requiresUserInput true ise bu alanı kullan.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Soru için benzersiz bir ID (örn: q1, q2)" },
          text: { type: Type.STRING, description: "Sorunun metni" },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Kullanıcının seçebileceği olası cevap seçenekleri"
          }
        },
        required: ["id", "text", "options"]
      }
    }
  },
  required: ["agentRole", "message", "actionSummary", "isDocumentationPhase", "requiresUserInput"]
};