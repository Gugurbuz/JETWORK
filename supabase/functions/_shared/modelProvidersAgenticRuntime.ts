export * from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@9a3e67f1a18169339ead06a86d93adc8ec242137/supabase/functions/_shared/modelProviders.ts?agentic-provider-base=5'
import { requestGeminiResponse as baseRequestGeminiResponse } from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@9a3e67f1a18169339ead06a86d93adc8ec242137/supabase/functions/_shared/modelProviders.ts?agentic-provider-base=5'

const KNOWLEDGE_TOOL_NAME = 'research_knowledge'
const ARTIFACT_BUNDLE_TOOL_NAME = 'create_artifact_bundle'
const RELATION_BUNDLE = new Set(['CALLS','READS','WRITES','EMITS_MESSAGE'])

const mergeUsage = (...values: Array<Record<string, number> | undefined>) => {
  const merged: Record<string, number> = {}
  for (const value of values) {
    for (const [key, raw] of Object.entries(value || {})) {
      const amount = Number(raw)
      if (Number.isFinite(amount)) merged[key] = (merged[key] || 0) + amount
    }
  }
  return merged
}

const responseHasFunctionCall = (response: any) => (
  Array.isArray(response?.output) && response.output.some((item: any) => item?.type === 'function_call')
)

const visibleResponseText = (response: any) => (
  (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => item?.type === 'message' && Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('')
    .trim()
)

const parseJson = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

type ObservedCall = {
  name: string
  args: Record<string, unknown>
  output: Record<string, unknown> | null
}

const observedCalls = (items: Array<Record<string, unknown>>): ObservedCall[] => {
  const calls = new Map<string, ObservedCall>()
  for (const item of items || []) {
    const type = String(item?.type || '')
    const callId = String(item?.call_id || '')
    if (type === 'function_call' && callId) {
      calls.set(callId, {
        name: String(item.name || ''),
        args: parseJson(item.arguments),
        output: null,
      })
      continue
    }
    if (type === 'function_call_output' && callId && calls.has(callId)) {
      const existing = calls.get(callId) as ObservedCall
      calls.set(callId, { ...existing, output: parseJson(item.output) })
    }
  }
  return [...calls.values()]
}

const knowledgeBundleComplete = (items: Array<Record<string, unknown>>) => (
  observedCalls(items).some(call => {
    if (call.name !== KNOWLEDGE_TOOL_NAME || !call.output) return false
    const records = call.output.records && typeof call.output.records === 'object' && !Array.isArray(call.output.records)
      ? call.output.records as Record<string, unknown>
      : {}
    return call.output.citationReady === true
      && records.mechanicalCoverageComplete === true
      && Array.isArray(records.resolvedExactTargets)
      && records.resolvedExactTargets.length > 0
  })
)

const artifactBundleComplete = (items: Array<Record<string, unknown>>) => (
  observedCalls(items).some(call => {
    if (call.name !== ARTIFACT_BUNDLE_TOOL_NAME || !call.output) return false
    const outputs = Array.isArray(call.output.outputs) ? call.output.outputs : []
    return outputs.length > 0 && outputs.every(output => {
      if (!output || typeof output !== 'object') return false
      const summary = (output as Record<string, unknown>).summary
      if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false
      const row = summary as Record<string, unknown>
      const verification = row.artifactVerification
      if (verification && typeof verification === 'object' && !Array.isArray(verification)) {
        const verified = verification as Record<string, unknown>
        return verified.reloadVerified === true && verified.integrityVerified === true
      }
      return Number(row.artifactCount || 0) > 0
    })
  })
)

const legacyExactEvidenceClosed = (items: Array<Record<string, unknown>>) => {
  const calls = observedCalls(items)
  const exact = new Set(calls
    .filter(call => call.output?.citationReady === true && ['get_knowledge_object','get_abap_source'].includes(call.name))
    .map(call => String(call.args?.canonicalKey || '').toLocaleLowerCase('en-US'))
    .filter(Boolean))
  for (const call of calls) {
    if (call.name !== 'get_related_objects' || call.output?.citationReady !== true) continue
    const key = String(call.args?.canonicalKey || '').toLocaleLowerCase('en-US')
    const types = new Set((Array.isArray(call.args?.relationTypes) ? call.args.relationTypes : [])
      .map(value => String(value).toLocaleUpperCase('en-US')))
    if (
      exact.has(key)
      && String(call.args?.direction || '') === 'outgoing'
      && [...RELATION_BUNDLE].every(type => types.has(type))
    ) return true
  }
  return false
}

const isTransientGeminiUnavailable = (error: unknown) => (
  /\b503\b|high demand|status[^a-z]+UNAVAILABLE|Service Unavailable/i
    .test(String(error instanceof Error ? error.message : error || ''))
)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function requestWithTransientRetry(input: any): Promise<any> {
  let retries = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await baseRequestGeminiResponse(input)
      return retries < 1
        ? response
        : { ...response, usage: mergeUsage(response?.usage, { gemini_transient_503_retries: retries }) }
    } catch (error) {
      if (!isTransientGeminiUnavailable(error) || attempt >= 2 || input.signal?.aborted) throw error
      retries += 1
      await sleep(attempt === 0 ? 350 : 800)
    }
  }
  throw new Error('Gemini transient retry exhausted.')
}

async function requestAndBridgeVisibleOutput(input: any) {
  let streamed = ''
  const response = await requestWithTransientRetry({
    ...input,
    onText: (delta: string) => {
      if (delta) streamed += delta
      input.onText?.(delta)
    },
  })
  const responseText = visibleResponseText(response)
  let bridged = ''
  if (!streamed.trim() && responseText) {
    bridged = responseText
    input.onText?.(responseText)
    console.info('JETWORK_GEMINI_RESPONSE_OUTPUT_TEXT_BRIDGE', JSON.stringify({
      model: input.model,
      chars: responseText.length,
    }))
  }
  return {
    response: bridged
      ? { ...response, usage: mergeUsage(response?.usage, { gemini_response_output_text_bridge_used: 1 }) }
      : response,
    streamed,
    bridged,
  }
}

const toolName = (tool: Record<string, unknown>) => String(tool?.name || '')

export async function requestGeminiResponse(input: any): Promise<any> {
  const items = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
  const knowledgeClosed = knowledgeBundleComplete(items)
  const artifactClosed = artifactBundleComplete(items)
  const legacyClosed = legacyExactEvidenceClosed(items)

  let tools = Array.isArray(input.tools) ? [...input.tools] : []
  const closureInstructions: string[] = []

  if (knowledgeClosed) {
    tools = tools.filter((tool: Record<string, unknown>) => toolName(tool) !== KNOWLEDGE_TOOL_NAME)
    closureInstructions.push(
      '[JETWORK KNOWLEDGE DEPENDENCY COMPLETE]',
      'Knowledge Runtime v3 mechanically exact-verified all explicit requested exact targets and returned a shared evidence bundle with unresolvedCount=0. The research_knowledge dependency is closed for this turn. Do not reopen the same retrieval; reason from the verified bundle and continue to remaining user goals.',
    )
  }

  if (artifactClosed) {
    tools = tools.filter((tool: Record<string, unknown>) => toolName(tool) !== ARTIFACT_BUNDLE_TOOL_NAME)
    closureInstructions.push(
      '[JETWORK ARTIFACT DEPENDENCY COMPLETE]',
      'The requested artifact bundle has already been created and mechanically verified. Do not create duplicate files. Produce the user-visible final response referencing the completed artifacts.',
    )
  }

  if (legacyClosed) {
    closureInstructions.push(
      '[JETWORK LEGACY EXACT EVIDENCE CLOSURE]',
      'Legacy exact/detail plus comprehensive outgoing relation evidence is already verified. Prefer synthesis over reopening broad retrieval.',
    )
  }

  const effective = {
    ...input,
    tools,
    allowTools: Boolean(input.allowTools && tools.length > 0),
    instructions: [String(input.instructions || ''), ...closureInstructions].filter(Boolean).join('\n\n'),
  }

  const first = await requestAndBridgeVisibleOutput(effective)
  const firstVisible = `${first.streamed}${first.bridged}`
  if (firstVisible.trim() || responseHasFunctionCall(first.response)) {
    return {
      ...first.response,
      usage: mergeUsage(first.response?.usage, {
        ...(knowledgeClosed ? { knowledge_bundle_closure_applied: 1 } : {}),
        ...(artifactClosed ? { artifact_bundle_closure_applied: 1 } : {}),
      }),
    }
  }

  const artifactToolStillAvailable = tools.some((tool: Record<string, unknown>) => toolName(tool) === ARTIFACT_BUNDLE_TOOL_NAME)
  const recoveryTools = artifactToolStillAvailable && !artifactClosed ? tools : []
  const recovery = await requestAndBridgeVisibleOutput({
    ...effective,
    instructions: [
      effective.instructions,
      '[JETWORK EMPTY FINALIZATION RECOVERY]',
      artifactToolStillAvailable && !artifactClosed
        ? 'No visible answer was produced. If the user requested final artifacts and they are not created yet, complete them now using create_artifact_bundle from the already verified shared analysis state. Otherwise produce the final answer. Do not reopen knowledge retrieval.'
        : 'No visible answer was produced. Produce a user-visible final answer now using only verified observations. Do not reopen completed dependencies.',
    ].join('\n\n'),
    tools: recoveryTools,
    allowTools: recoveryTools.length > 0,
    allowProviderWeb: false,
  })
  const recoveryVisible = `${recovery.streamed}${recovery.bridged}`

  return {
    ...recovery.response,
    usage: mergeUsage(first.response?.usage, recovery.response?.usage, {
      gemini_empty_finalization_retry: 1,
      gemini_empty_finalization_retry_text_emitted: recoveryVisible.trim() ? 1 : 0,
      ...(knowledgeClosed ? { knowledge_bundle_closure_applied: 1 } : {}),
      ...(artifactClosed ? { artifact_bundle_closure_applied: 1 } : {}),
    }),
  }
}
