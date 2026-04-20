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
    const { chunks, metadata } = await req.json()
    
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      throw new Error("No chunks provided")
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase vars not set')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const ai = new GoogleGenAI({ apiKey })

    const recordsToInsert = [];

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      
      const embeddingResponse = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: chunk,
      });
      
      recordsToInsert.push({
        content: chunk,
        metadata: metadata || {},
        embedding: embeddingResponse.embeddings[0].values
      });
    }

    if (recordsToInsert.length > 0) {
      const { error } = await supabase
        .from('knowledge_base')
        .insert(recordsToInsert);
        
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true, inserted: recordsToInsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error("Embedding Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400,
    })
  }
})
