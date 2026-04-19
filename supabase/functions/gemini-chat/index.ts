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
    const { model, systemInstruction, contents, tools, currentDocument, responseSchema } = await req.json()
    
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
          match_threshold: 0.70, // %70 benzerlik altını alma
          match_count: 5 // En iyi 5 kuralı getir
        });

        if (!error && documents && documents.length > 0) {
          contextText = documents.map((d: any) => d.content).join('\n\n---\n\n');
        }
      } catch (e) {
        console.error("Embedding or RAG error:", e);
      }
    }

    // 4. CONTEXT INJECTION: Bulunan bilgileri sistem promptuna yedir
    const enrichedSystemInstruction = `
      ${systemInstruction}
      
      AŞAĞIDAKİ BİLGİLER ENERJİSA BİLGİ BANKASINDAN (KNOWLEDGE BASE) ÇEKİLMİŞTİR.
      Kararlarını verirken, sorularını sorarken ve dokümanı güncellerken KESİNLİKLE bu standartlara ve kurallara uy:
      
      <enerjisa_kurallari>
      ${contextText ? contextText : 'Spesifik bir kural bulunamadı, genel yazılım mimarisi standartlarını uygula.'}
      </enerjisa_kurallari>
      
      <mevcut_dokuman_durumu>
      ${JSON.stringify(currentDocument || {}, null, 2)}
      </mevcut_dokuman_durumu>
    `;

    const config: any = {
      systemInstruction: enrichedSystemInstruction,
      responseMimeType: responseSchema ? "application/json" : "text/plain",
      thinkingConfig: { thinkingLevel: "HIGH" }
    }
    
    if (responseSchema) {
      config.responseSchema = responseSchema
    }

    if (tools && tools.length > 0) {
      config.tools = tools
    } else if (!responseSchema) {
       config.tools = [{ googleSearch: {} }]
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
