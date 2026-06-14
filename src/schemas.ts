import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Type } from "@google/genai";

export const NewProjectInputSchema = z.object({
  name: z.string().trim().min(2, "Proje adÄ± en az 2 karakter olmalÄ±dÄ±r.").max(100, "Proje adÄ± en fazla 100 karakter olabilir."),
  description: z.string().trim().max(500, "AÃ§Ä±klama en fazla 500 karakter olabilir.").optional().default(""),
});

export const EditWorkspaceInputSchema = z.object({
  title: z.string().trim().min(2, "Ã‡alÄ±ÅŸma alanÄ± adÄ± en az 2 karakter olmalÄ±dÄ±r.").max(120, "Ã‡alÄ±ÅŸma alanÄ± en fazla 120 karakter olabilir."),
});

export const OnboardingInputSchema = z.object({
  username: z.string().trim().min(3, "KullanÄ±cÄ± adÄ± en az 3 karakter olmalÄ±dÄ±r.").max(32, "KullanÄ±cÄ± adÄ± en fazla 32 karakter olabilir.").regex(/^[a-zA-Z0-9._-]+$/, "KullanÄ±cÄ± adÄ± yalnÄ±zca harf, rakam, nokta, alt Ã§izgi ve tire iÃ§erebilir."),
  firstName: z.string().trim().min(1, "Ad alanÄ± zorunludur.").max(50, "Ad en fazla 50 karakter olabilir."),
  lastName: z.string().trim().min(1, "Soyad alanÄ± zorunludur.").max(50, "Soyad en fazla 50 karakter olabilir."),
  role: z.string().trim().min(1, "Rol seÃ§imi zorunludur."),
});

export const SectionDataSchema = z.object({
  content: z.string().describe("Markdown formatÄ±nda iÃ§erik metni."),
  status: z.enum(['DRAFT', 'NEEDS_REVISION', 'APPROVED']).describe("Bu bÃ¶lÃ¼mÃ¼n gÃ¼ncel durumu."),
  flags: z.array(z.string()).describe("Bu bÃ¶lÃ¼me ait kalite, eksik bilgi veya revizyon notlarÄ±."),
});

export const DocumentDataSchema = z.object({
  businessAnalysis: SectionDataSchema.describe("Ana kavramsal tasarÄ±m / BA analiz raporu."),
  review: SectionDataSchema.optional().describe("Kalite deÄŸerlendirmesi, aÃ§Ä±k sorular ve revizyon notlarÄ±."),
  code: SectionDataSchema.optional().describe("Geriye dÃ¶nÃ¼k uyumluluk alanÄ±. Yeni Ã¼retimde kullanÄ±lmaz."),
  test: SectionDataSchema.optional().describe("Geriye dÃ¶nÃ¼k uyumluluk alanÄ±. Yeni Ã¼retimde kullanÄ±lmaz."),
  bpmn: SectionDataSchema.optional().describe("Geriye dÃ¶nÃ¼k uyumluluk alanÄ±. Yeni Ã¼retimde kullanÄ±lmaz."),
});

export const TaskExtractionSchema = z.object({
  title: z.string().describe("GÃ¶rev veya hatanÄ±n kÄ±sa ve aÃ§Ä±klayÄ±cÄ± baÅŸlÄ±ÄŸÄ±."),
  description: z.string().describe("GÃ¶rev veya hatanÄ±n detaylÄ± aÃ§Ä±klamasÄ±."),
  type: z.enum(["Bug", "Feature", "Improvement", "Task"]).describe("KaydÄ±n tÃ¼rÃ¼."),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).describe("Ã–ncelik durumu."),
  assignee: z.string().optional().describe("EÄŸer konuÅŸmada belirtilmiÅŸse, gÃ¶revin atanacaÄŸÄ± kiÅŸinin adÄ±."),
  estimatedHours: z.number().optional().describe("EÄŸer belirtilmiÅŸse tahmini efor (saat cinsinden)."),
});

export const FeedbackSchema = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("Metnin genel duygu durumu."),
  summary: z.string().describe("KullanÄ±cÄ±nÄ±n geri bildiriminin veya mesajÄ±nÄ±n kÄ±sa Ã¶zeti."),
  actionItems: z.array(z.string()).describe("EÄŸer varsa, metinden Ã§Ä±karÄ±lan aksiyon adÄ±mlarÄ±."),
});

export const documentDataJsonSchema = zodToJsonSchema(DocumentDataSchema, "DocumentData");
export const taskExtractionJsonSchema = zodToJsonSchema(TaskExtractionSchema, "TaskExtraction");
export const feedbackJsonSchema = zodToJsonSchema(FeedbackSchema, "Feedback");

export const ChatResponseSchema = z.object({
  thinking: z.string().optional().describe("KÄ±sa Ã§alÄ±ÅŸma Ã¶zeti. Gizli zincir dÃ¼ÅŸÃ¼nce yazÄ±lmaz."),
  message: z.string().describe("KullanÄ±cÄ±ya sohbette gÃ¶sterilecek kÄ±sa yanÄ±t metni. Dokuman uretildi veya guncellendiyse mesajin sonunda Markdown ile **Ne yaptim?** basligi altinda 1-2 cumlelik gorunur ozet yaz."),
  actionSummary: z.string().optional().describe("Bu mesajÄ±n veya ajanÄ±n yaptÄ±ÄŸÄ± eylemin kullanicinin gorecegi kadar net, cok kisa ozeti."),
  score: z.number().optional().describe("Kalite puanÄ± veya zero-touch skor alanÄ±."),
  scoreExplanation: z.string().optional().describe("Puan aÃ§Ä±klamasÄ±."),
  needsRevision: z.array(z.string()).optional().describe("Revizyon gerektiren alanlar."),
  updatedMemory: z.record(z.string(), z.string()).optional().describe("Proje kararlarÄ± veya yeni kÄ±sÄ±tlamalar."),
  questions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    options: z.array(z.string()),
  })).optional().describe("KullanÄ±cÄ±ya sorulacak netleÅŸtirici sorular."),
  document: DocumentDataSchema.optional().describe("SaÄŸ panel dokÃ¼manÄ±. Åimdilik sadece businessAnalysis ve opsiyonel review Ã¼retilmelidir."),
});

export const applyMicroEditTool = {
  functionDeclarations: [
    {
      name: "apply_micro_edit",
      description: "DokÃ¼manÄ±n BA Analiz veya Review bÃ¶lÃ¼mÃ¼ndeki mevcut bir metni yenisiyle deÄŸiÅŸtirir.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          section: {
            type: Type.STRING,
            description: "GÃ¼ncellenecek dokÃ¼man sekmesi",
            enum: ["businessAnalysis", "review"],
          },
          targetText: {
            type: Type.STRING,
            description: "DeÄŸiÅŸtirilecek cÃ¼mlenin veya paragrafÄ±n dokÃ¼mandaki birebir mevcut hali.",
          },
          replacementText: {
            type: Type.STRING,
            description: "Hedef metnin yerine geÃ§ecek yeni metin.",
          },
          explanation: {
            type: Type.STRING,
            description: "Chat ekranÄ±nda kullanÄ±cÄ±ya gÃ¶sterilecek kÄ±sa Ã¶zet.",
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
      description: "KÄ±sa Ã§alÄ±ÅŸma Ã¶zeti. Gizli zincir dÃ¼ÅŸÃ¼nce yazma.",
    },
    message: {
      type: Type.STRING,
      description: "KullanÄ±cÄ±ya veya ekibe sohbette gÃ¶sterilecek kÄ±sa yanÄ±t metni. Dokuman uretildi veya guncellendiyse mesajin sonunda Markdown ile **Ne yaptim?** basligi altinda 1-2 cumlelik gorunur ozet yaz.",
    },
    actionSummary: {
      type: Type.STRING,
      description: "Bu mesajÄ±n veya ajanÄ±n yaptÄ±ÄŸÄ± eylemin kullanicinin gorecegi kadar net, cok kisa ozeti.",
    },
    score: {
      type: Type.NUMBER,
      description: "Kalite puanÄ± veya zero-touch skor alanÄ±.",
    },
    scoreExplanation: {
      type: Type.STRING,
      description: "Puan aÃ§Ä±klamasÄ±.",
    },
    needsRevision: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Revizyon gerektiren alanlar.",
    },
    updatedMemory: {
      type: Type.OBJECT,
      description: "KullanÄ±cÄ±nÄ±n mesajÄ±ndan Ã§Ä±karÄ±lan yeni proje kararlarÄ±, kÄ±sÄ±tlamalarÄ± veya hedefleri.",
      additionalProperties: { type: Type.STRING },
    },
    questions: {
      type: Type.ARRAY,
      description: "KullanÄ±cÄ±ya sorulacak netleÅŸtirici sorular ve seÃ§enekleri.",
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
      description: "SaÄŸ paneldeki Ã‡alÄ±ÅŸma DokÃ¼manÄ±. Åimdilik sadece BA Analiz ve opsiyonel Review Ã¼ret.",
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
        description: "DokÃ¼manÄ±n BA Analiz veya Review bÃ¶lÃ¼mÃ¼ndeki mevcut bir metni yenisiyle deÄŸiÅŸtirir.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            section: {
              type: Type.STRING,
              description: "GÃ¼ncellenecek dokÃ¼man sekmesi",
              enum: ["businessAnalysis", "review"],
            },
            targetText: {
              type: Type.STRING,
              description: "DeÄŸiÅŸtirilecek cÃ¼mlenin veya paragrafÄ±n dokÃ¼mandaki birebir mevcut hali.",
            },
            replacementText: {
              type: Type.STRING,
              description: "Hedef metnin yerine geÃ§ecek yeni metin.",
            },
            explanation: {
              type: Type.STRING,
              description: "Chat ekranÄ±nda kullanÄ±cÄ±ya gÃ¶sterilecek kÄ±sa Ã¶zet.",
            },
          },
          required: ["section", "targetText", "replacementText", "explanation"],
        },
      },
    ],
  },
];
