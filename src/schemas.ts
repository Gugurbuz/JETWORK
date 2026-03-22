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
  actionSummary: z.string().optional().describe("Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti. Örn: 'İş Analisti gereksinimleri dokümana ekledi.', 'Test Uzmanı test senaryolarını yazdı.'"),
  document: DocumentDataSchema.optional().describe("Eğer kullanıcı bir doküman (iş analizi, kod, test) oluşturulmasını veya güncellenmesini istediyse bu alanı doldur. İstemediyle boş bırak (null/undefined)."),
  score: z.number().optional().describe("Zero-Touch Mode için ajanın verdiği puan (0-100)."),
  scoreExplanation: z.string().optional().describe("Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin kısa özeti. Sadece Moderatör tarafından doldurulur.")
});

export const chatResponseJsonSchema = {
  type: Type.OBJECT,
  properties: {
    message: {
      type: Type.STRING,
      description: "Kullanıcıya sohbette gösterilecek yanıt metni. Markdown formatında olabilir."
    },
    actionSummary: {
      type: Type.STRING,
      description: "Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti. Örn: 'İş Analisti gereksinimleri dokümana ekledi.', 'Test Uzmanı test senaryolarını yazdı.'"
    },
    score: {
      type: Type.NUMBER,
      description: "Zero-Touch Mode için ajanın verdiği puan (0-100). Sadece bu modda doldurulmalıdır."
    },
    scoreExplanation: {
      type: Type.STRING,
      description: "Verilen puanın detayı, eksikler, riskler ve yapılan iyileştirmelerin ÇOK KISA (maksimum 2-3 cümle) özeti. Sadece Moderatör tarafından doldurulur. ASLA 'Bitti', 'Tamamlandı', 'Başarılar' gibi kelimeleri tekrar etme."
    },
    needsRevision: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Eğer dokümanın revize edilmesi gerekiyorsa, revizyon yapması gereken ajanların rollerini (BA, IT, QA) bu diziye ekle. Eğer revizyona gerek yoksa boş bırak."
    },
    document: {
      type: Type.OBJECT,
      description: "Eğer kullanıcı bir doküman (iş analizi, kod, test) oluşturulmasını veya güncellenmesini istediyse bu alanı doldur. İstemediyle boş bırak (null/undefined).",
      properties: {
        businessAnalysis: {
          type: Type.OBJECT,
          description: "İş analizi dokümanı. Kesinlikle belirtilen formata uymalıdır.",
          properties: {
            "1_ANALIZ_KAPSAMI": { type: Type.STRING, description: "Analiz Kapsamı" },
            "2_KISALTMALAR": { type: Type.STRING, description: "Kısaltmalar" },
            "3_IS_GEREKSINIMLERI": {
              type: Type.OBJECT,
              properties: {
                "3_1_Is_Kurallari": { type: Type.STRING, description: "İş Kuralları. Maddeleri yazarken markdown listesi (1. 2.) KULLANMA. Bunun yerine maddeleri 3.1.1., 3.1.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
                "3_2_Is_Modeli_ve_Kullanici_Gereksinimleri": { type: Type.STRING, description: "İş Modeli ve Kullanıcı Gereksinimleri. Maddeleri 3.2.1., 3.2.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." }
              },
              required: ["3_1_Is_Kurallari", "3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]
            },
            "4_FONKSIYONEL_GEREKSINIMLER": { type: Type.STRING, description: "Fonksiyonel Gereksinimler (FR). Maddeleri 4.1., 4.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
            "5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER": {
              type: Type.OBJECT,
              properties: {
                "5_1_Guvenlik_ve_Yetkilendirme": { type: Type.STRING, description: "Güvenlik ve Yetkilendirme Gereksinimleri. Maddeleri 5.1.1., 5.1.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
                "5_2_Performans": { type: Type.STRING, description: "Performans Gereksinimleri. Maddeleri 5.2.1., 5.2.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
                "5_3_Raporlama": { type: Type.STRING, description: "Raporlama Gereksinimleri. Maddeleri 5.3.1., 5.3.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." }
              },
              required: ["5_1_Guvenlik_ve_Yetkilendirme", "5_2_Performans", "5_3_Raporlama"]
            },
            "6_SUREC_RISK_ANALIZI": {
              type: Type.OBJECT,
              properties: {
                "6_1_Kisitlar_ve_Varsayimlar": { type: Type.STRING, description: "Kısıtlar ve Varsayımlar. Maddeleri 6.1.1., 6.1.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
                "6_2_Bagliliklar": { type: Type.STRING, description: "Bağlılıklar. Maddeleri 6.2.1., 6.2.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." },
                "6_3_Surec_Etkileri": { type: Type.STRING, description: "Süreç Etkileri. Maddeleri 6.3.1., 6.3.2. şeklinde numaralandırarak alt alta yaz ve aralarına mutlaka iki satır boşluğu (\\n\\n) koy." }
              },
              required: ["6_1_Kisitlar_ve_Varsayimlar", "6_2_Bagliliklar", "6_3_Surec_Etkileri"]
            },
            "7_ONAY": {
              type: Type.OBJECT,
              properties: {
                "7_1_Is_Analizi": { type: Type.STRING, description: "İş Analizi Onay Tablosu" },
                "7_2_Degisiklik_Kayitlari": { type: Type.STRING, description: "Değişiklik Kayıtları Tablosu" },
                "7_3_Dokuman_Onay": { type: Type.STRING, description: "Doküman Onay Tablosu" },
                "7_4_Referans_Dokumanlar": { type: Type.STRING, description: "Referans Dokümanlar Tablosu" }
              },
              required: ["7_1_Is_Analizi", "7_2_Degisiklik_Kayitlari", "7_3_Dokuman_Onay", "7_4_Referans_Dokumanlar"]
            },
            "8_FONKSIYONEL_TASARIM_DOKUMANLARI": { type: Type.STRING, description: "Fonksiyonel Tasarım Dokümanları Tablosu" }
          },
          required: [
            "1_ANALIZ_KAPSAMI", "2_KISALTMALAR", "3_IS_GEREKSINIMLERI", 
            "4_FONKSIYONEL_GEREKSINIMLER", "5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER", 
            "6_SUREC_RISK_ANALIZI", "7_ONAY", "8_FONKSIYONEL_TASARIM_DOKUMANLARI"
          ]
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
          description: "Toplantı notları, ne yapıldı, ne karar alındı, kim ne söyledi gibi önemli bilgilerin özeti. SADECE profesyonel toplantı notları, Karar Matrisi ve Risk/Aksiyon planı içermelidir. ASLA kendi içsel düşüncelerini (reasoning), puanlama gerekçelerini (score explanation) veya 'Bitti', 'Tamamlandı' gibi gereksiz metinleri yazma. Markdown formatında olmalıdır."
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
    actionSummary: {
      type: Type.STRING,
      description: "Bu mesajın veya ajanın yaptığı eylemin çok kısa (1 cümlelik) bir özeti. Örn: 'İş Analisti gereksinimleri netleştirdi.', 'Test Uzmanı edge-case'leri sordu.', 'Ekip PostgreSQL kullanma kararı aldı.'"
    },
    isDocumentationPhase: {
      type: Type.BOOLEAN,
      description: "Eğer ekip çözümde uzlaştıysa ve dokümantasyona geçilecekse true, aksi halde false"
    },
    requiresUserInput: {
      type: Type.BOOLEAN,
      description: "Eğer mimarinin netleşmesi için müşteriden (kullanıcıdan) kritik bir bilgi alınması gerekiyorsa bunu true yap. BU ÇOK ÖNEMLİDİR: requiresUserInput true olduğunda, sistem otonom tartışmayı DURDURUR ve kullanıcıdan cevap bekler. DİKKAT: Kullanıcıya soru sorarken 'message' alanında MUTLAKA '@Kullanıcı' diyerek başla ve soruları 1., 2., 3. şeklinde maddeler halinde alt alta yaz."
    },
    document: {
      type: Type.OBJECT,
      description: "Sadece Moderatör tarafından doldurulur. Tartışma sırasında alınan kararları ve toplantı notlarını 'review' alanına yazmak için kullanılır.",
      properties: {
        review: {
          type: Type.STRING,
          description: "Toplantı notları, ne yapıldı, ne karar alındı, kim ne söyledi gibi önemli bilgilerin özeti. SADECE profesyonel toplantı notları, Karar Matrisi ve Risk/Aksiyon planı içermelidir. ASLA kendi içsel düşüncelerini (reasoning), puanlama gerekçelerini (score explanation) veya 'Bitti', 'Tamamlandı' gibi gereksiz metinleri yazma. Markdown formatında olmalıdır."
        }
      }
    },
    questions: {
      type: Type.ARRAY,
      description: "Eğer requiresUserInput true ise, kullanıcıya sorulacak soruları ve muhtemel kısa cevap seçeneklerini buraya ekle. Soru sorulmuyorsa boş dizi [] gönder.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Soru için benzersiz ID (örn: q1, q2)" },
          text: { type: Type.STRING, description: "Sorunun kendisi" },
          options: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }, 
            description: "Kullanıcının seçebileceği muhtemel kısa cevaplar (Örn: ['Evet, kapasite yeterli', 'Hayır, yetersiz', 'Bilinmiyor'])" 
          }
        },
        required: ["id", "text", "options"]
      }
    }
  },
  required: ["agentRole", "message", "actionSummary", "isDocumentationPhase", "requiresUserInput", "questions"]
};
