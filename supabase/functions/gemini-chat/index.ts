import { serve } from "[https://deno.land/std@0.168.0/http/server.ts](https://deno.land/std@0.168.0/http/server.ts)"
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

    // 1. Kullanıcının son mesajını alıp niyetini çıkar
    const lastUserMessage = contents.filter((c: any) => c.role === 'user').pop()?.parts[0]?.text || '';

    // 2. EMBEDDING: Kullanıcı mesajını vektöre çevir
    let contextText = "";
    if (lastUserMessage && supabaseUrl && supabaseServiceKey) {
      try {
        const embeddingResponse = await ai.models.embedContent({
          model: 'text-embedding-004',
          contents: lastUserMessage,
        });
        const queryEmbedding = embeddingResponse.embeddings[0].values;

        // 3. SEMANTIC SEARCH: Veritabanında en benzer kuralları bul
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

    // VIBE ANALYZING İÇİN ZORUNLU ARAÇLARI (TOOLS) TANIMLAMA
    const coreFunctionDeclarations = [
      {
        name: "ask_clarification_questions",
        description: "Kullanıcıdan gelen talepte eksik iş kuralları, NFR veya mimari karar eksikliği varsa DOKÜMANI YAZMADAN ÖNCE soru sormak için KESİNLİKLE bu aracı kullan.",
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
            contextReason: { type: "STRING", description: "Bu soruları neden sorduğuna dair kullanıcıya gösterilecek kısa açıklama." }
          },
          required: ["questions", "contextReason"]
        }
      },
      {
        name: "update_document_section",
        description: "Kullanıcıyla anlaşıldığında, analiz dokümanını Tiptap (Semantic HTML) formatında güncellemek için kullanılır. DİKKAT: Markdown kullanma, düz HTML döndür.",
        parameters: {
          type: "OBJECT",
          properties: {
            tabName: { type: "STRING", description: "Örn: BA Analiz, IT Analiz, Test" },
            htmlContent: { type: "STRING", description: "Saf HTML formatında oluşturulmuş TAM içerik. Başına ve sonuna ```html koyma." },
            actionSummary: { type: "STRING", description: "Nelerin güncellendiğine dair kısa özet." }
          },
          required: ["tabName", "htmlContent", "actionSummary"]
        }
      }
    ];

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

    // 4. CONTEXT INJECTION: Sistem promptuna bilgileri yedir
    const enrichedSystemInstruction = `
      ${systemInstruction}
      
      [DİKKAT - VIBE ANALYZING ALGORİTMASI]
      Bir talebi incelerken HEMEN UZUN METİNLER YAZMA. Önce düşün! Eksik bilgi varsa 'googleSearch' veya 'ask_clarification_questions' kullan. Analiz netleştiğinde 'update_document_section' kullan.
      
      AŞAĞIDAKİ BİLGİLER ENERJİSA BİLGİ BANKASINDAN (KNOWLEDGE BASE) ÇEKİLMİŞTİR:
      <enerjisa_kurallari>
      ${contextText ? contextText : 'Spesifik bir kural bulunamadı, genel standartları uygula.'}
      </enerjisa_kurallari>
      
      <mevcut_dokuman_durumu>
      ${JSON.stringify(currentDocument || {}, null, 2)}
      </mevcut_dokuman_durumu>
    `;

    // 400 Hatasını çözen toolConfig (Google SDK)
    const config: any = {
      systemInstruction: enrichedSystemInstruction,
      tools: combinedTools,
      toolConfig: { includeServerSideToolInvocations: true },
      thinkingConfig: { thinkingLevel: "HIGH" }
    }
    
    if (responseSchema) {
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