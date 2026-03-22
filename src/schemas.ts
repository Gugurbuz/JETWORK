import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Type } from "@google/genai";

export const DocumentDataSchema = z.object({
  businessAnalysis: z.string().describe("İş analizi, gereksinimler ve projenin genel tanımı. Markdown formatında olmalıdır."),
  code: z.string().describe("Teknik notlar, mimari kararlar, veritabanı şemaları veya örnek kod blokları. Markdown formatında olmalıdır."),
  test: z.string().describe("Test senaryoları, kabul kriterleri ve QA adımları. Markdown formatında olmalıdır."),
  bpmn: z.string().optional().describe("Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış, entegrasyon veya durum makinesi içeriyorsa mutlaka doldur. XML tagleri ile başlamalıdır."),
  review: z.string().optional().describe("Toplantı notları, ne yapıldı, ne karar alındı, kim ne söyledi gibi önemli bilgilerin özeti. Markdown formatında olmalıdır."),
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
  message: z.string().describe("Kullanıcıya veya ekibe sohbette gösterilecek yanıt metni. Markdown formatında olabilir."),
  actionSummary: z.string().optional().describe("Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti."),
  score: z.number().optional().describe("Zero-Touch Mode için ajanın verdiği puan (0-100)."),
  scoreExplanation: z.string().optional().describe("Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin kısa özeti."),
  needsRevision: z.array(z.string()).optional().describe("Eğer revize edilmesi gerekiyorsa, ajanların rollerini (BA, IT, QA) buraya ekle."),
  updatedMemory: z.record(z.string(), z.string()).optional().describe("Proje kararları veya yeni kısıtlamalar (Örn: {'Platform': 'Web'})."),
  // Geriye dönük uyumluluk için document kısmı opsiyonel bırakıldı, ancak asıl işlem Tools (Araçlar) üzerinden yapılacak.
  document: DocumentDataSchema.optional().describe("SADECE EĞER ARAÇ (TOOL) KULLANAMIYORSAN BU ALANI DOLDUR. Eğer 'update_document_section' aracına sahipsen bu alanı KESİNLİKLE BOŞ BIRAK.")
});

export const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
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
    document: {
      type: Type.OBJECT,
      description: "SADECE EĞER ARAÇ (TOOL) KULLANAMIYORSAN BU ALANI DOLDUR. Yeni mimaride dokümanı güncellemek için 'update_document_section' fonksiyonunu çağırmalısın. Bu alanı boş bırak (null/undefined).",
      properties: {
        businessAnalysis: { type: Type.STRING },
        code: { type: Type.STRING },
        test: { type: Type.STRING },
        review: { type: Type.STRING },
        bpmn: { type: Type.STRING }
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
        name: "update_document_section",
        description: "Dokümanın belirli bir alanını günceller. Koca bir dokümanı baştan yazmak yerine sadece değişmesi gereken yeri (Delta/Patch) göndermek için kullanılır.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "Güncellenecek doküman sekmesi",
              enum: ["businessAnalysis", "code", "test", "review", "bpmn"]
            },
            operation: {
              type: Type.STRING,
              description: "Yapılacak işlem türü: 'append' (mevcut metnin sonuna ekle) veya 'replace' (mevcut metni tamamen yenisiyle değiştir). Varsayılan olarak append kullan.",
              enum: ["append", "replace"]
            },
            content: {
              type: Type.STRING,
              description: "Eklenecek veya değiştirilecek Markdown veya XML (BPMN) formatındaki detaylı ve KISALTILMAMIŞ içerik."
            },
            actionSummary: {
              type: Type.STRING,
              description: "Sohbette gösterilecek 1 cümlelik özet. Örn: 'Veritabanı şeması eklendi.'"
            }
          },
          required: ["section", "operation", "content", "actionSummary"]
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
    agentRole: { type: Type.STRING },
    message: { type: Type.STRING },
    actionSummary: { type: Type.STRING },
    isDocumentationPhase: { type: Type.BOOLEAN },
    requiresUserInput: { type: Type.BOOLEAN }
  },
  required: ["agentRole", "message", "actionSummary", "isDocumentationPhase", "requiresUserInput"]
};