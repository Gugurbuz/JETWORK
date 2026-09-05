import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "npm:@google/genai@1.52.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GEMINI_38_MODEL = 'gemini-3.8-flash'
const migratableLegacyModels = new Set([
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
])

function hasUnsupportedSchemaReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false

  const schema = value as Record<string, unknown>
  if ('$ref' in schema || '$defs' in schema || 'definitions' in schema) return true

  return Object.values(schema).some(child => {
    if (Array.isArray(child)) return child.some(hasUnsupportedSchemaReference)
    return hasUnsupportedSchemaReference(child)
  })
}

function isSupportedGeminiSchema(responseSchema: unknown): boolean {
  if (!responseSchema || typeof responseSchema !== 'object') return false
  return !hasUnsupportedSchemaReference(responseSchema)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) {
      return new Response(JSON.stringify({ error: 'Authentication is required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

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
    await authResponse.body?.cancel()

    const contentLength = Number(req.headers.get('content-length') || 0)
    if (contentLength > 2_000_000) {
      return new Response(JSON.stringify({ error: 'Request payload is too large.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 413,
      })
    }

    const {
      model,
      systemInstruction,
      contents,
      responseSchema,
      tools,
      toolConfig,
    } = await req.json()
    const requestedModel = String(model || '').trim()
    if (requestedModel !== GEMINI_38_MODEL && !migratableLegacyModels.has(requestedModel)) {
      throw new Error('Requested model is not allowed.')
    }
    const executionModel = GEMINI_38_MODEL
    const supportedResponseSchema = isSupportedGeminiSchema(responseSchema) ? responseSchema : null
    
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables')
    }

    const ai = new GoogleGenAI({ apiKey })

    const config: any = {
      systemInstruction: systemInstruction,
      responseMimeType: supportedResponseSchema ? "application/json" : "text/plain",
      thinkingConfig: { thinkingLevel: 'medium' },
    }

    if (supportedResponseSchema) {
      config.responseSchema = supportedResponseSchema
    }
    
    if (tools && tools.length > 0) {
      config.tools = tools
    } else if (!supportedResponseSchema) {
      config.tools = [{ googleSearch: {} }]
    }

    if (toolConfig) {
      config.toolConfig = toolConfig
    }

    const responseStream = await ai.models.generateContentStream({
      model: executionModel,
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
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'x-jetwork-gemini-model': executionModel,
      },
    })
  } catch (error) {
    console.error("Function error:", error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
