import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI, ThinkingLevel } from "npm:@google/genai"

const corsHeaderBase = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

function getAllowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

function getCorsHeaders(req: Request): Record<string, string> {
  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.length === 0) {
    return { ...corsHeaderBase, 'Access-Control-Allow-Origin': '*' }
  }

  const requestOrigin = req.headers.get('Origin')
  const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0]

  return { ...corsHeaderBase, 'Access-Control-Allow-Origin': allowOrigin }
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch (_error) {
    return null
  }
}

function isAuthenticatedToken(token: string): boolean {
  const payload = decodeJwtPayload(token)
  return payload?.role === 'authenticated' && typeof payload?.sub === 'string' && payload.sub.length > 0
}

function jsonError(message: string, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
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
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const bearerToken = getBearerToken(req)
  if (!bearerToken || !isAuthenticatedToken(bearerToken)) {
    return jsonError('Authentication required', 401, corsHeaders)
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
    const message = error instanceof Error ? error.message : String(error)
    console.error("Function error:", error)
    return jsonError(message, 400, corsHeaders)
  }
})