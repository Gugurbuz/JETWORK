import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Type } from "@google/genai";

export const NewProjectInputSchema = z.object({
  name: z.string().trim().min(2, "Proje adı en az 2 karakter olmalıdır.").max(100, "Proje adı en fazla 100 karakter olabilir."),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir.").optional().default(""),
});

export const EditWorkspaceInputSchema = z.object({
  title: z.string().trim().min(2, "Çalışma alanı adı en az 2 karakter olmalıdır.").max(120, "Çalışma alanı en fazla 120 karakter olabilir."),
});

export const OnboardingInputSchema = z.object({
  username: z.string().trim().min(3, "Kullanıcı adı en az 3 karakter olmalıdır.").max(32, "Kullanıcı adı en fazla 32 karakter olabilir.").regex(/^[a-zA-Z0-9._-]+$/, "Kullanıcı adı yalnızca harf, rakam, nokta, alt çizgi ve tire içerebilir."),
  firstName: z.string().trim().min(1, "Ad alanı zorunludur.").max(50, "Ad en fazla 50 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyad alanı zorunludur.").max(50, "Soyad en fazla 50 karakter olabilir."),
  role: z.string().trim().min(1, "Rol seçimi zorunludur."),
});

export const SectionDataSchema = z.object({
  content: z.string().describe("Markdown formatında içerik metni."),
  status: z.enum(['DRAFT', 'NEEDS_REVISION', 'APPROVED']).describe("Bu bölümün güncel durumu."),
  flags: z.array(z.string()).describe("Bu bölüme ait kalite, eksik bilgi veya revizyon notları."),
});

export const DocumentDataSchema = z.object({
  businessAnalysis: SectionDataSchema.describe("Ana kavramsal tasarım / BA analiz raporu."),
  review: SectionDataSchema.optional().describe("Kalite değerlendirmesi, açık sorular ve revizyon notları."),
  code: SectionDataSchema.optional().describe("Geriye dönük uyumluluk alanı. Yeni üretimde kullanılmaz."),
  test: SectionDataSchema.optional().describe("Geriye dönük uyumluluk alanı. Yeni üretimde kullanılmaz."),
  bpmn: SectionDataSchema.optional().describe("Geriye dönük uyumluluk alanı. Yeni üretimde kullanılmaz."),
});

export const TaskExtractionSchema = z.object({
  title: z.string().describe("Görev veya hatanın kısa ve açıklayıcı başlığı."),
  description: z.string().describe("Görev veya hatanın detaylı açıklaması."),
  type: z.enum(["Bug", "Feature", "Improvement", "Task"]).describe("Kaydın türü."),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).describe("Öncelik durumu."),
  assignee: z.string().optional().describe("Eğer konuşmada belirtilmişse, görevin atanacağı kişinin adı."),
  estimatedHours: z.number().optional().describe("Eğer belirtilmişse tahmini efor (saat cinsinden)."),
});

export const FeedbackSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Metnin genel duygu durumu."),
  summary: z.string().describe("Kullanıcının geri bildiriminin veya mesajının kısa özeti."),
  actionItems: z.array(z.string()).describe("Eğer varsa, metinden çıkarılan aksiyon adımları."),
});

export const documentDataJsonSchema = zodToJsonSchema(DocumentDataSchema, "DocumentData");
export const taskExtractionJsonSchema = zodToJsonSchema(TaskExtractionSchema, "TaskExtraction");
export const feedbackJsonSchema = zodToJsonSchema(FeedbackSchema, "Feedback");

export const ChatResponseSchema = z.object({
  thinking: z.string().optional().describe("Kısa çalışma özeti. Gizli zincir düşünce yazılmaz."),
  message: z.string().describe("Kullanıcıya sohbette gösterilecek kısa yanıt metni. Dokuman uretildi veya guncellendiyse mesajin sonunda Markdown ile **Ne yaptim?** basligi altinda 1-2 cumlelik gorunur ozet yaz."),
  actionSummary: z.string().optional().describe("Bu mesajın veya ajanın yaptığı eylemin kullanicinin gorecegi kadar net, cok kisa ozeti."),
  score: z.number().optional().describe("Kalite puanı veya zero-touch skor alanı."),
  scoreExplanation: z.string().optional().describe("Puan açıklaması."),
  needsRevision: z.array(z.string()).optional().describe("Revizyon gerektiren alanlar."),
  updatedMemory: z.record(z.string(), z.string()).optional().describe("Proje kararları veya yeni kısıtlamalar."),
  questions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    options: z.array(z.string()),
  })).optional().describe("Kullanıcıya sorulacak netleştirici sorular."),
  document: DocumentDataSchema.optional().describe("Sağ panel dokümanı. Şimdilik sadece businessAnalysis ve opsiyonel review üretilmelidir."),
});

export const applyMicroEditTool = {
  functionDeclarations: [
    {
      name: "apply_micro_edit",
      description: "Dokümanın BA Analiz veya Review bölümündeki mevcut bir metni yenisiyle değiştirir.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          section: {
            type: Type.STRING,
            description: "Güncellenecek doküman sekmesi",
            enum: ["businessAnalysis", "review"],
          },
          targetText: {
            type: Type.STRING,
            description: "Değiştirilecek cümlenin veya paragrafın dokümandaki birebir mevcut hali.",
          },
          replacementText: {
            type: Type.STRING,
            description: "Hedef metnin yerine geçecek yeni metin.",
          },
          explanation: {
            type: Type.STRING,
            description: "Chat ekranında kullanıcıya gösterilecek kısa özet.",
          },
        },
        required: ["section", "targetText", "replacementText", "explanation"],
      },
    },
  ],
};

const sectionDataJsonType = {
  type: Type.OBJECT,
  properties: {
    content: { type: Type.STRING },
    status: { type: Type.STRING },
    flags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

export const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    thinking: {
      type: Type.STRING,
      description: "Kısa çalışma özeti. Gizli zincir düşünce yazma.",
    },
    message: {
      type: Type.STRING,
      description: "Kullanıcıya veya ekibe sohbette gösterilecek kısa yanıt metni. Dokuman uretildi veya guncellendiyse mesajin sonunda Markdown ile **Ne yaptim?** basligi altinda 1-2 cumlelik gorunur ozet yaz.",
    },
    actionSummary: {
      type: Type.STRING,
      description: "Bu mesajın veya ajanın yaptığı eylemin kullanicinin gorecegi kadar net, cok kisa ozeti.",
    },
    score: {
      type: Type.NUMBER,
      description: "Kalite puanı veya zero-touch skor alanı.",
    },
    scoreExplanation: {
      type: Type.STRING,
      description: "Puan açıklaması.",
    },
    needsRevision: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Revizyon gerektiren alanlar.",
    },
    updatedMemory: {
      type: Type.OBJECT,
      description: "Kullanıcının mesajından çıkarılan yeni proje kararları, kısıtlamaları veya hedefleri.",
      additionalProperties: { type: Type.STRING },
    },
    questions: {
      type: Type.ARRAY,
      description: "Kullanıcıya sorulacak netleştirici sorular ve seçenekleri.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          text: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["id", "text", "options"],
      },
    },
    document: {
      type: Type.OBJECT,
      description: "Sağ paneldeki Çalışma Dokümanı. Şimdilik sadece BA Analiz ve opsiyonel Review üret.",
      properties: {
        businessAnalysis: sectionDataJsonType,
        review: sectionDataJsonType,
      },
    },
  },
  required: ["message"],
};

export type ZodChatResponse = z.infer<typeof ChatResponseSchema>;

export const agentTools: any[] = [
  {
    functionDeclarations: [
      {
        name: "apply_micro_edit",
        description: "Dokümanın BA Analiz veya Review bölümündeki mevcut bir metni yenisiyle değiştirir.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "Güncellenecek doküman sekmesi",
              enum: ["businessAnalysis", "review"],
            },
            targetText: {
              type: Type.STRING,
              description: "Değiştirilecek cümlenin veya paragrafın dokümandaki birebir mevcut hali.",
            },
            replacementText: {
              type: Type.STRING,
              description: "Hedef metnin yerine geçecek yeni metin.",
            },
            explanation: {
              type: Type.STRING,
              description: "Chat ekranında kullanıcıya gösterilecek kısa özet.",
            },
          },
          required: ["section", "targetText", "replacementText", "explanation"],
        },
      },
    ],
  },
];
