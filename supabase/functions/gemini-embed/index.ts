import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "npm:@google/genai@1.29.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization) {
    return new Response(JSON.stringify({ error: 'Authentication is required.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 401,
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) {
      throw new Error('Supabase authentication environment is unavailable')
    }

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authorization,
        apikey: anonKey,
      },
    })
    if (!authResponse.ok) {
      return new Response(JSON.stringify({ error: 'A valid user session is required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const contentLength = Number(req.headers.get('content-length') || 0)
    if (contentLength > 100_000) {
      return new Response(JSON.stringify({ error: 'Request payload is too large.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 413,
      })
    }

    const { text, purpose = 'query' } = await req.json()
    const input = String(text || '').trim()
    if (!input) {
      throw new Error('text is required')
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables')
    }

    const ai = new GoogleGenAI({ apiKey })
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: input.slice(0, 24_000),
      config: {
        taskType: purpose === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
      },
    })
    const embedding = response.embeddings?.[0]?.values
    if (!embedding || embedding.length !== 768) {
      throw new Error('Embedding response is invalid')
    }

    return new Response(JSON.stringify({ embedding }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Embedding function error:', error)
    const message = error instanceof Error ? error.message : 'Unexpected embedding error'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
