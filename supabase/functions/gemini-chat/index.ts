import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "npm:@google/genai"
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { model, systemInstruction, contents, tools: frontendTools, currentDocument, responseSchema } = await req.json()
    
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '')
    const ai = new GoogleGenAI({ apiKey })

    // 1. Niyet Çıkarımı
    const lastUserMessage = contents.filter((c: any) => c.role === 'user').pop()?.parts[0]?.text || '';

    // 2. RAG (Bilgi Bankası) Araması
    let contextText = "";
    if (lastUserMessage && supabaseUrl && supabaseServiceKey) {
      try {
        const embeddingResponse = await ai.models.embedContent({
          model: 'text-embedding-004',
          contents: lastUserMessage,
        });
        const queryEmbedding = embeddingResponse.embeddings[0].values;

        const { data: documents, error } = await supabase.rpc('match_documents', {
          query_embedding: queryEmbedding,
          match_threshold: 0.70,
          match_count: 5 
        });

        if (!error && documents && documents.length > 0) {
          contextText = documents.map((d: any) => d.content).join('\n\n---\n\n');
        }
      } catch (e) {
        console.error("Embedding or RAG error:", e);
      }
    }

    // 3. VIBE ANALYZING İÇİN ZORUNLU ARAÇLARI (TOOLS) TANIMLAMA
    const coreFunctionDeclarations = [
      {
        name: "ask_clarification_questions",
        description: "Kullanıcıdan gelen talepte eksik iş kuralları, NFR veya mimari karar eksikliği varsa DOKÜMANI YAZMADAN ÖNCE Soru sormak için KESİNLİKLE bu aracı kullan.",
        parameters: {
          type: "OBJECT",
          properties: {
            questions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  id: { type: "STRING", description: "q1, q2 gibi benzersiz ID" },
                  text: { type: "STRING", description: "Sorunun metni" },
                  options: { type: "ARRAY", items: { type: "STRING" }, description: "Çoktan seçmeli opsiyonlar (Yoksa boş dizi gönder)" }
                }
              }
            },
            contextReason: { type: "STRING", description: "Bu soruları neden sorduğuna dair kullanıcıya gösterilecek açıklama." }
          },
          required: ["questions", "contextReason"]
        }
      },
      {
        name: "update_document_section",
        description: "Kullanıcıyla anlaşıldığında ve tüm bilgiler toplandığında, analiz dokümanını Tiptap (Semantic HTML) formatında güncellemek için kullanılır.",
        parameters: {
          type: "OBJECT",
          properties: {
            tabName: { type: "STRING", description: "Örn: BA Analiz, IT Analiz, Test" },
            htmlContent: { type: "STRING", description: "HTML formatında oluşturulmuş TAM içerik." },
            actionSummary: { type: "STRING", description: "Nelerin güncellendiğine dair kısa özet." }
          },
          required: ["tabName", "htmlContent", "actionSummary"]
        }
      }
    ];

    // Frontend'den gelen tool'lar ile arka plandaki zorunlu tool'ları birleştir
    let allFunctions = [...coreFunctionDeclarations];
    
    if (frontendTools && frontendTools.length > 0) {
      frontendTools.forEach((t: any) => {
        if (t.functionDeclarations) {
          allFunctions = [...allFunctions, ...t.functionDeclarations];
        }
      });
    }

    // Google Search her zaman eklenecek
    const combinedTools = [
      { functionDeclarations: allFunctions },
      { googleSearch: {} } 
    ];

    // 4. SİSTEM PROMPTUNU GÜÇLENDİRME (AI'YI DURDURMA ALGORİTMASI)
    const enrichedSystemInstruction = `
      ${systemInstruction}
      
      [DİKKAT - VIBE ANALYZING ALGORİTMASI - KESİN İTAAT ET]
      Sen bir metin yazarı değil, sistem analistisin. Sana bir talep geldiğinde HEMEN UZUN METİNLER ÜRETMEYE BAŞLAMA!
      
      ADIM 1 - KONTROL: Talep net mi? İş kuralları eksik mi? Dış bilgiye (Örn: yasal mevzuat, libor oranları) ihtiyaç var mı?
      ADIM 2 - AKSİYON (ZORUNLU): 
         - Dış bilgi lazımsa 'googleSearch' aracını KULLAN.
         - İş kuralı veya detay eksiği varsa HEMEN 'ask_clarification_questions' aracını KULLAN. (ASLA DOKÜMAN YAZMA).
      ADIM 3 - SONUÇ: Sadece kullanıcı tüm soruları cevapladığında veya talep %100 netleştiğinde 'update_document_section' aracını çağırarak HTML dokümanı üret.

      <bilgi_bankasi_referanslari>
      ${contextText ? contextText : 'Özel bir referans bulunamadı.'}
      </bilgi_bankasi_referanslari>
      
      <mevcut_dokuman_durumu>
      ${JSON.stringify(currentDocument || {}, null, 2)}
      </mevcut_dokuman_durumu>
    `;

    // 400 HATASINI ÇÖZEN CONFIG EKLENTİSİ
    const config: any = {
      systemInstruction: enrichedSystemInstruction,
      tools: combinedTools,
      toolConfig: { includeServerSideToolInvocations: true }, // Gemini API Zorunluluğu
      thinkingConfig: { thinkingLevel: "HIGH" }
    }
    
    // Eğer responseSchema varsa ekle
    if (responseSchema && Object.keys(responseSchema).length > 0) {
      config.responseSchema = responseSchema;
      config.responseMimeType = "application/json";
    }

    // 5. LLM'e İsteği Gönder ve Stream Et
    const responseStream = await ai.models.generateContentStream({
      model: model,
      contents: contents,
      config: config
    })

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const data = JSON.stringify(chunk)
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
          }
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`))
          controller.close()
        } catch (e) {
          console.error("Streaming error:", e)
          controller.error(e)
        }
      }
    })

    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
    })
  }
})