import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import {
  attachSemanticPlan,
  buildSemanticExecutionPlan,
  type PriorExecutionContext,
  type SemanticContextMessage,
} from '../_shared/semanticOrchestrator.ts'
import { compactSemanticContextMessage } from '../_shared/conversationMemory.ts'
import { normalizeAssistantActiveOperation } from '../_shared/operationState.ts'
import {
  applyEnerjisaAnalysisDocxProfile,
  DOCUMENT_FILE_EXECUTOR_TOOL,
  type DocumentArtifactRouteDecision,
} from '../_shared/documentArtifactRouting.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-jetwork-document-profile',
}
const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const clean = (value: unknown, max = 32_000) => String(value ?? '').trim().slice(0, max)
const cleanArray = (value: unknown, limit: number, max: number) => Array.isArray(value)
  ? value.map(item => clean(item, max)).filter(Boolean).slice(0, limit)
  : []

interface RequestBody {
  workspaceId?: unknown
  messageId?: unknown
  message?: unknown
  model?: unknown
  chatAttachments?: unknown
}

const routeDecision: DocumentArtifactRouteDecision = {
  artifactRoute: true,
  enerjisaAnalysisDocx: true,
  reason: 'enerjisa_analysis_document',
}

const providerForRequest = (model: string) => model.startsWith('gemini-') ? 'gemini' as const : 'openai' as const
const modelForPlan = (model: string) => model === 'auto' ? 'gpt-5.6-sol' : model

async function loadContext(input: {
  client: any
  workspaceId: string
  messageId: string
}) {
  const [currentResult, workspaceResult] = await Promise.all([
    input.client.from('messages')
      .select('id,created_at')
      .eq('workspace_id', input.workspaceId)
      .eq('id', input.messageId)
      .maybeSingle(),
    input.client.from('workspaces')
      .select('id,title')
      .eq('id', input.workspaceId)
      .maybeSingle(),
  ])
  if (currentResult.error || !currentResult.data?.created_at) {
    throw currentResult.error || new Error('Current user message could not be loaded.')
  }
  if (workspaceResult.error || !workspaceResult.data) {
    throw workspaceResult.error || new Error('Workspace access denied.')
  }

  const currentCreatedAt = String(currentResult.data.created_at)
  const [historyResult, priorResult] = await Promise.all([
    input.client.from('messages')
      .select('id,role,text,created_at')
      .eq('workspace_id', input.workspaceId)
      .in('role', ['user','model'])
      .lt('created_at', currentCreatedAt)
      .order('created_at', { ascending: false })
      .limit(12),
    input.client.rpc('get_prior_assistant_execution_context', {
      p_workspace_id: input.workspaceId,
      p_before: currentCreatedAt,
      p_exclude_message_id: input.messageId,
    }),
  ])
  if (historyResult.error) throw historyResult.error

  const conversation: SemanticContextMessage[] = [...(historyResult.data || [])]
    .reverse()
    .map((row: any) => {
      const role = row.role === 'user' ? 'user' as const : 'assistant' as const
      return { role, content: compactSemanticContextMessage(role, row.text) }
    })
    .filter(item => item.content)

  const previousRun = priorResult.data && typeof priorResult.data === 'object' && !Array.isArray(priorResult.data)
    ? priorResult.data as Record<string, unknown>
    : undefined
  const priorExecution: PriorExecutionContext | undefined = previousRun ? {
    messageId: clean(previousRun.messageId, 240),
    intent: clean(previousRun.intent, 80),
    complexity: clean(previousRun.complexity, 40),
    knowledgeUsed: previousRun.knowledgeUsed === true,
    webUsed: previousRun.webUsed === true,
    toolCallCount: Number(previousRun.toolCallCount || 0),
    responseModel: clean(previousRun.responseModel, 120),
    provider: clean(previousRun.provider, 40),
    artifactStatus: clean(previousRun.artifactStatus, 80),
    artifactOperation: clean(previousRun.artifactOperation, 80),
    resolvedRequest: clean(previousRun.resolvedRequest, 900) || undefined,
    activeEntities: cleanArray(previousRun.activeEntities, 10, 180),
    requestedEvidence: cleanArray(previousRun.requestedEvidence, 8, 120),
    verifiedFactRefs: cleanArray(previousRun.verifiedFactRefs, 12, 320),
    activeOperation: normalizeAssistantActiveOperation(previousRun.activeOperation),
  } : undefined

  return {
    conversation,
    priorExecution,
    workspaceTitle: clean(workspaceResult.data.title, 300),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  let payload: RequestBody
  try {
    const parsed = await req.json()
    payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RequestBody : {}
  } catch {
    return jsonResponse({ error: 'Request body is invalid.' }, 400)
  }

  const workspaceId = clean(payload.workspaceId, 200)
  const messageId = clean(payload.messageId, 240)
  const message = clean(payload.message, 26_000)
  const requestedModel = clean(payload.model, 80) || 'auto'
  if (!workspaceId || !messageId || !message) {
    return jsonResponse({ error: 'workspaceId, messageId and message are required.' }, 400)
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  let context
  try {
    context = await loadContext({ client, workspaceId, messageId })
  } catch (error) {
    console.error('Enerjisa DOCX context could not be loaded:', error)
    return jsonResponse({ error: 'Doküman bağlamı hazırlanamadı. Lütfen tekrar deneyin.', code: 'DOCUMENT_CONTEXT_UNAVAILABLE' }, 503)
  }

  const semantic = await buildSemanticExecutionPlan({
    provider: providerForRequest(requestedModel),
    model: modelForPlan(requestedModel),
    message,
    conversation: context.conversation,
    priorExecution: context.priorExecution,
    workspaceTitle: context.workspaceTitle,
    attachmentNames: Array.isArray(payload.chatAttachments)
      ? payload.chatAttachments.map((item: any) => clean(item?.name, 240)).filter(Boolean)
      : [],
  })

  // This endpoint is deterministic only about the explicitly requested artifact:
  // the final deliverable is an Enerjisa DOCX. Research, skill selection, evidence
  // gathering, web use, re-planning and self-review remain controller-LLM decisions.
  // The semantic plan is retained as advisory context instead of being overwritten
  // with a fixed knowledge-only pipeline.
  const plan = {
    ...semantic.plan,
    intent: 'document' as const,
    executionMode: 'artifact' as const,
    promptProfile: 'artifact' as const,
    complexity: semantic.plan.complexity === 'low' ? 'medium' as const : semantic.plan.complexity,
    creativeMode: false,
    enumerationTarget: undefined,
    goal: semantic.plan.conversationState?.resolvedRequest || message,
    artifactRequired: true,
    artifactPreferredTool: DOCUMENT_FILE_EXECUTOR_TOOL,
    orchestratorVersion: 'enerjisa-analysis-docx-controller-v2',
  }

  // Critical ordering: semantic intent is resolved from the ORIGINAL user message first.
  // The canonical Enerjisa contract is appended only after planning, so its headings
  // cannot be mistaken for a function-inventory request or a semantic routing signal.
  const profiledMessage = applyEnerjisaAnalysisDocxProfile(message, routeDecision)
  const coreMessage = attachSemanticPlan(profiledMessage, plan)
  const corePayload = {
    ...payload,
    message: coreMessage,
  }

  let upstream: Response
  try {
    upstream = await fetch(`${supabaseUrl}/functions/v1/openai-assistant-core-v2`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: anonKey,
        'Content-Type': 'application/json',
        'x-client-info': 'jetwork-enerjisa-analysis-docx-controller/v2',
      },
      body: JSON.stringify(corePayload),
    })
  } catch (error) {
    console.error('Enerjisa DOCX orchestrator could not reach reasoning core:', error)
    return jsonResponse({ error: 'Doküman üretim runtimeına bağlanılamadı.', code: 'DOCUMENT_CORE_UNREACHABLE' }, 502)
  }

  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'x-jetwork-document-profile')
  headers.set('x-jetwork-document-profile', 'enerjisa-analysis-docx-controller-v2')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
})