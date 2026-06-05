import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI, ThinkingLevel } from "npm:@google/genai"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
    const { model, systemInstruction, contents, responseSchema, tools, toolConfig } = await req.json()
    const supportedResponseSchema = isSupportedGeminiSchema(responseSchema) ? responseSchema : null
    
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables')
    }

    const ai = new GoogleGenAI({ apiKey })

    const config: any = {
      systemInstruction: systemInstruction,
      responseMimeType: supportedResponseSchema ? "application/json" : "text/plain",
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
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
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error("Function error:", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
