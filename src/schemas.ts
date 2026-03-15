import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Type } from "@google/genai";

// 1. Doküman Verisi Şeması (DocumentData)
// Sağ paneldeki iş analizi, kod ve test sekmelerini doldurmak için kullanılacak.
export const DocumentDataSchema = z.object({
  businessAnalysis: z.string().describe("İş analizi, gereksinimler ve projenin genel tanımı. Markdown formatında olmalıdır."),
  code: z.string().describe("Teknik notlar, mimari kararlar, veritabanı şemaları veya örnek kod blokları. Markdown formatında olmalıdır."),
  test: z.string().describe("Test senaryoları, kabul kriterleri ve QA adımları. Markdown formatında olmalıdır."),
  bpmn: z.string().optional().describe("Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış, entegrasyon veya durum makinesi içeriyorsa mutlaka doldur. XML tagleri ile başlamalıdır."),
  review: z.string().optional().describe("Toplantı notları, ne yapıldı, ne karar alındı, kim ne söyledi gibi önemli bilgilerin özeti. Markdown formatında olmalıdır."),
});

// 2. Görev/Hata Çıkarım Şeması (Task Extraction)
// Sohbet panelindeki konuşmalardan otomatik görev veya hata kaydı oluşturmak için.
export const TaskExtractionSchema = z.object({
  title: z.string().describe("Görev veya hatanın kısa ve açıklayıcı başlığı."),
  description: z.string().describe("Görev veya hatanın detaylı açıklaması."),
  type: z.enum(["Bug", "Feature", "Improvement", "Task"]).describe("Kaydın türü."),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).describe("Öncelik durumu."),
  assignee: z.string().optional().describe("Eğer konuşmada belirtilmişse, görevin atanacağı kişinin adı."),
  estimatedHours: z.number().optional().describe("Eğer belirtilmişse tahmini efor (saat cinsinden).")
});

// 3. Geri Bildirim/Duygu Analizi Şeması (Feedback/Sentiment)
// Kullanıcının yazdığı metnin genel duygu durumunu ve özetini çıkarmak için.
export const FeedbackSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Metnin genel duygu durumu."),
  summary: z.string().describe("Kullanıcının geri bildiriminin veya mesajının kısa özeti."),
  actionItems: z.array(z.string()).describe("Eğer varsa, metinden çıkarılan aksiyon adımları.")
});

// JSON Schema Dönüşümleri (Gemini API'nin beklediği format)
export const documentDataJsonSchema = zodToJsonSchema(DocumentDataSchema, "DocumentData");
export const taskExtractionJsonSchema = zodToJsonSchema(TaskExtractionSchema, "TaskExtraction");
export const feedbackJsonSchema = zodToJsonSchema(FeedbackSchema, "Feedback");

// 4. Chat Response Schema
// Yapılandırılmış çıktı (Structured Output) ile modelin döneceği ana JSON formatı.
export const ChatResponseSchema = z.object({
  message: z.string().describe("Kullanıcıya sohbette gösterilecek yanıt metni. Markdown formatında olabilir."),
  document: DocumentDataSchema.optional().describe("Eğer kullanıcı bir doküman (iş analizi, kod, test) oluşturulmasını veya güncellenmesini istediyse bu alanı doldur. İstemediyle boş bırak (null/undefined)."),
  score: z.number().optional().describe("Zero-Touch Mode için ajanın verdiği puan (0-100)."),
  scoreExplanation: z.string().optional().describe("Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin kısa özeti. Sadece Orkestratör tarafından doldurulur.")
});

export const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    message: {
      type: Type.STRING,
      description: "Kullanıcıya sohbette gösterilecek yanıt metni. Markdown formatında olabilir."
    },
    score: {
      type: Type.NUMBER,
      description: "Zero-Touch Mode için ajanın verdiği puan (0-100). Sadece bu modda doldurulmalıdır."
    },
    scoreExplanation: {
      type: Type.STRING,
      description: "Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin kısa özeti. Sadece Orkestratör tarafından doldurulur."
    },
    needsRevision: {
      type: Type.BOOLEAN,
      description: "Eğer Orkestratör puanı 90'ın altındaysa ve ekibin dokümanları baştan yazması gerekiyorsa true yap. Sadece Orkestratör tarafından doldurulur."
    },
    document: {
      type: Type.OBJECT,
      description: "Eğer kullanıcı bir doküman (iş analizi, kod, test) oluşturulmasını veya güncellenmesini istediyse bu alanı doldur. İstemediyle boş bırak (null/undefined).",
      properties: {
        businessAnalysis: {
          type: Type.STRING,
          description: "İş analizi, gereksinimler ve projenin genel tanımı. Markdown formatında olmalıdır."
        },
        code: {
          type: Type.STRING,
          description: "Teknik notlar, mimari kararlar, veritabanı şemaları veya örnek kod blokları. Markdown formatında olmalıdır."
        },
        test: {
          type: Type.STRING,
          description: "Test senaryoları, kabul kriterleri ve QA adımları. Markdown formatında olmalıdır."
        },
        review: {
          type: Type.STRING,
          description: "Toplantı notları, ne yapıldı, ne karar alındı, kim ne söyledi gibi önemli bilgilerin özeti. Markdown formatında olmalıdır."
        },
        bpmn: {
          type: Type.STRING,
          description: "Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış, entegrasyon veya durum makinesi içeriyorsa mutlaka doldur. XML tagleri ile başlamalıdır."
        }
      }
    }
  },
  required: ["message"]
};

export type ZodChatResponse = z.infer<typeof ChatResponseSchema>;

export const discussionJsonSchema = {
  type: Type.OBJECT,
  properties: {
    agentRole: {
      type: Type.STRING,
      description: "Konuşacak ajanın rolü (PO, BA, IT, QA, SM)"
    },
    message: {
      type: Type.STRING,
      description: "Ajanın söyleyeceği mesaj"
    },
    isDocumentationPhase: {
      type: Type.BOOLEAN,
      description: "Eğer ekip çözümde uzlaştıysa ve dokümantasyona geçilecekse true, aksi halde false"
    },
    requiresUserInput: {
      type: Type.BOOLEAN,
      description: "Eğer mimarinin netleşmesi için müşteriden (kullanıcıdan) kritik bir bilgi alınması gerekiyorsa true yapın. Bu, otonom tartışmayı durdurur ve kullanıcıdan cevap bekler. DİKKAT: Kullanıcıya soru sorarken 'message' alanında MUTLAKA '@Kullanıcı' diyerek başla ve soruları 1., 2., 3. şeklinde maddeler halinde alt alta yaz."
    }
  },
  required: ["agentRole", "message", "isDocumentationPhase"]
};
