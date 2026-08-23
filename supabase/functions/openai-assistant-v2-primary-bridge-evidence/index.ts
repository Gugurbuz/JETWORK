import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { GoogleGenAI } from 'npm:@google/genai@1.52.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'x-jetwork-auto-route,x-jetwork-auto-evidence',
}
const streamHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-JetWork-Primary-Agent-Bridge': 'v3-evidence-aware',
}

const AUTO_MODEL = 'auto'
const LITE_MODEL = 'gemini-3.5-flash-lite'
const FLASH_MODEL = 'gemini-3.5-flash'
const PRO_MODEL = 'gemini-3.1-pro-preview'
const ROUTER_VERSION = 'primary-bridge-evidence-v2'
const MAX_CONTEXT_MESSAGES = 6
const MAX_CONTEXT_CHARS = 3_000
const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/gu

type RoutedModel = typeof LITE_MODEL | typeof FLASH_MODEL | typeof PRO_MODEL
type EvidenceState = 'none' | 'complete' | 'unresolved' | 'conflict' | 'no_evidence'
type RouterUsage = { inputTokens:number; outputTokens:number; reasoningTokens:number; totalTokens:number; estimatedCostUsd:number }
type RouteDecision = {
  routedModel: RoutedModel
  decision: 'USE_LITE' | 'USE_FLASH' | 'USE_PRO'
  usage: RouterUsage
  evidenceState: EvidenceState
  reasons: string[]
}

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const unique = <T>(items:T[]) => [...new Set(items)]
const responseText = (response:any) => typeof response?.text === 'string'
  ? response.text.trim()
  : Array.isArray(response?.candidates?.[0]?.content?.parts)
    ? response.candidates[0].content.parts.filter((part:any) => !part?.thought && typeof part?.text === 'string').map((part:any) => String(part.text)).join('').trim()
    : ''
const routerUsage = (response:any):RouterUsage => {
  const m = response?.usageMetadata || {}
  const inputTokens = Math.max(0, Number(m.promptTokenCount || 0))
  const outputTokens = Math.max(0, Number(m.candidatesTokenCount || 0))
  const reasoningTokens = Math.max(0, Number(m.thoughtsTokenCount || 0))
  const totalTokens = Math.max(0, Number(m.totalTokenCount || inputTokens + outputTokens + reasoningTokens))
  const estimatedCostUsd = ((inputTokens * 0.30) + ((outputTokens + reasoningTokens) * 2.50)) / 1_000_000
  return { inputTokens, outputTokens, reasoningTokens, totalTokens, estimatedCostUsd }
}

async function loadCompactContext(client:any, workspaceId:string, messageId:string) {
  if (!workspaceId) return ''
  let query = client.from('messages').select('role,text,created_at').eq('workspace_id', workspaceId).in('role',['user','model']).order('created_at',{ascending:false}).limit(MAX_CONTEXT_MESSAGES)
  if (messageId) query = query.neq('id', messageId)
  const { data, error } = await query
  if (error || !Array.isArray(data)) return ''
  let used = 0
  const lines:string[] = []
  for (const row of [...data].reverse()) {
    const line = `${row.role === 'user' ? 'user' : 'assistant'}: ${clean(String(row.text || '').replace(/\s+/g,' '),700)}`
    if (used + line.length > MAX_CONTEXT_CHARS) break
    lines.push(line); used += line.length
  }
  return lines.join('\n')
}

const relationIntent = (message:string) => /(?:hangi\s+(?:mesaj|fonksiyon|metot|method|tablo|servis)|mesaj(?:ları|lari)?\s+(?:üret|uret)|çağır|cagir|calls?|kullan|uses?|ilişki|iliski|bağlı|bagli|depends?|emit|produce)/iu.test(message)

async function inspectEvidence(client:any, workspaceId:string, message:string) {
  const identifiers = unique([...message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match => match[0])).slice(0,6)
  if (!identifiers.length) return { state:'none' as EvidenceState, identifiers, direct:0, references:0, relations:0, conflicts:0 }
  const { data: workspace } = await client.from('workspaces').select('project_id').eq('id',workspaceId).maybeSingle()
  const [globalSpaces,projectSpaces] = await Promise.all([
    client.from('knowledge_spaces').select('id').eq('scope_type','global'),
    workspace?.project_id ? client.from('knowledge_spaces').select('id').eq('project_id',String(workspace.project_id)) : Promise.resolve({data:[],error:null}),
  ])
  const spaceIds = unique([...(globalSpaces.data || []).map((r:any)=>String(r.id)), ...((projectSpaces as any).data || []).map((r:any)=>String(r.id))].filter(Boolean))
  if (!spaceIds.length) return { state:'no_evidence' as EvidenceState, identifiers, direct:0, references:0, relations:0, conflicts:0 }

  const directRows:any[] = []
  const refRows:any[] = []
  for (const id of identifiers) {
    const [byName, byCanonical, byContent] = await Promise.all([
      client.from('knowledge_objects_v2').select('id,canonical_key,object_type,name').eq('publication_status','published').in('knowledge_space_id',spaceIds).ilike('name',`%${id}%`).limit(20),
      client.from('knowledge_objects_v2').select('id,canonical_key,object_type,name').eq('publication_status','published').in('knowledge_space_id',spaceIds).ilike('canonical_key',`%${id.toLocaleLowerCase('en-US')}%`).limit(20),
      client.from('knowledge_object_versions_v2').select('id,object_id').in('knowledge_space_id',spaceIds).eq('is_current',true).ilike('content',`%${id}%`).limit(40),
    ])
    directRows.push(...(byName.data || []), ...(byCanonical.data || []))
    refRows.push(...(byContent.data || []))
  }
  const direct = [...new Map(directRows.map(row=>[String(row.id),row])).values()]
  const canonicalKeys = direct.map((row:any)=>String(row.canonical_key)).filter(Boolean)
  let relations:any[] = []
  let conflicts:any[] = []
  if (canonicalKeys.length) {
    const relationParts = canonicalKeys.flatMap((key:string)=>[`source_canonical_key.eq.${key}`,`target_canonical_key.eq.${key}`]).join(',')
    const conflictParts = canonicalKeys.flatMap((key:string)=>[`canonical_key.eq.${key}`,`related_canonical_key.eq.${key}`]).join(',')
    const [rr,cr] = await Promise.all([
      client.from('knowledge_relations_v2').select('id,relation_type,source_canonical_key,target_canonical_key').in('knowledge_space_id',spaceIds).eq('active',true).or(relationParts).limit(80),
      client.from('knowledge_review_items_v3').select('id,review_type').in('knowledge_space_id',spaceIds).eq('status','open').in('review_type',['possible_conflict','low_confidence_relation']).or(conflictParts).limit(20),
    ])
    relations = rr.data || []
    conflicts = cr.data || []
  }
  const directCount = direct.length
  const references = unique(refRows.map((row:any)=>String(row.object_id))).length
  const asksRelation = relationIntent(message)
  let state:EvidenceState = 'no_evidence'
  if (conflicts.length) state = 'conflict'
  else if (directCount > 0 && (!asksRelation || relations.length > 0 || references > 1)) state = 'complete'
  else if (directCount > 0 || references > 0) state = 'unresolved'
  return { state, identifiers, direct:directCount, references, relations:relations.length, conflicts:conflicts.length }
}

async function routeAuto(input:{apiKey:string;message:string;context:string;attachments:any[];evidence:Awaited<ReturnType<typeof inspectEvidence>>}):Promise<RouteDecision> {
  const ai = new GoogleGenAI({apiKey:input.apiKey})
  const prompt = [
    `Current user request:\n${clean(input.message,3000)}`,
    input.context ? `Recent conversation context (continuity only, not evidence):\n${input.context}` : '',
    input.attachments.length ? `Attachments: ${input.attachments.slice(0,3).map(item=>`${clean(item?.name,120)} (${clean(item?.mimeType,80)})`).join(', ')}` : '',
    `Enterprise evidence state: ${input.evidence.state}. Direct objects=${input.evidence.direct}; content references=${input.evidence.references}; graph relations=${input.evidence.relations}; conflicts=${input.evidence.conflicts}.`,
    input.evidence.identifiers.length ? `Exact technical identifiers: ${input.evidence.identifiers.join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
  const response = await ai.models.generateContent({
    model:LITE_MODEL,
    contents:[{role:'user',parts:[{text:prompt}]}],
    config:{
      systemInstruction:[
        'You are the JetWork model routing gate. Do not answer the user.',
        'Output exactly one token: USE_LITE, USE_FLASH, or USE_PRO.',
        'Start exact enterprise identifier lookups on Lite when published evidence is complete. Exact identifiers are never permanently locked to Lite.',
        'Choose USE_FLASH when evidence exists but the relation/context remains unresolved, or when the request needs materially stronger synthesis.',
        'Choose USE_PRO when the evidence state is conflict or the request is unusually difficult and multi-constraint.',
        'No enterprise evidence is not by itself a reason to spend more model capacity.',
        'Use the structured evidence state above; never infer escalation from phrases in a drafted answer.',
        'Judge the whole request and conversation, not isolated keywords.',
      ].join(' '), temperature:0, maxOutputTokens:16,
    },
  } as any)
  const raw = responseText(response).toUpperCase()
  let decision:RouteDecision['decision'] = raw === 'USE_LITE' ? 'USE_LITE' : raw === 'USE_PRO' ? 'USE_PRO' : 'USE_FLASH'
  const reasons:string[] = [`classifier_${decision.toLocaleLowerCase('en-US')}`]
  if (input.evidence.state === 'conflict') { decision='USE_PRO'; reasons.push('evidence_conflict_floor_pro') }
  else if (input.evidence.state === 'unresolved' && decision === 'USE_LITE') { decision='USE_FLASH'; reasons.push('evidence_unresolved_floor_flash') }
  else if (input.evidence.state === 'complete') reasons.push('evidence_complete_lite_capable')
  else if (input.evidence.state === 'no_evidence') reasons.push('no_evidence_no_capacity_escalation_rule')
  const routedModel:RoutedModel = decision === 'USE_LITE' ? LITE_MODEL : decision === 'USE_PRO' ? PRO_MODEL : FLASH_MODEL
  return { routedModel, decision, usage:routerUsage(response), evidenceState:input.evidence.state, reasons }
}

const numericUsage = (value:unknown) => { const out:Record<string,number>={}; if(!value||typeof value!=='object'||Array.isArray(value))return out; for(const[k,v]of Object.entries(value as Record<string,unknown>)){const n=Number(v);if(Number.isFinite(n))out[k]=n}return out }
const addUsage = (...values:Array<Record<string,number>|undefined>) => { const out:Record<string,number>={}; for(const value of values)for(const[k,n]of Object.entries(value||{}))if(Number.isFinite(n))out[k]=(out[k]||0)+n; return out }
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function persistRouteTelemetry(input:{supabaseUrl:string;serviceRoleKey:string;workspaceId:string;messageId:string;route:RouteDecision}) {
  if(!input.workspaceId||!input.messageId)return
  const admin=createClient(input.supabaseUrl,input.serviceRoleKey,{auth:{persistSession:false}})
  let turn:any=null
  for(const delayMs of [0,100,300,800,1500]){if(delayMs)await sleep(delayMs);const{data}=await admin.from('assistant_turns').select('id,usage').eq('workspace_id',input.workspaceId).eq('message_id',input.messageId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(data?.id){turn=data;break}}
  if(!turn?.id)return
  const routeUsage={
    input_tokens:input.route.usage.inputTokens,output_tokens:input.route.usage.outputTokens,reasoning_tokens:input.route.usage.reasoningTokens,total_tokens:input.route.usage.totalTokens,estimated_cost_usd:input.route.usage.estimatedCostUsd,
    primary_llm_router_calls:1,auto_model_cascade_started:1,auto_model_router_calls:1,
    ...(input.route.routedModel===LITE_MODEL?{auto_model_routed_lite:1}:{}),...(input.route.routedModel===FLASH_MODEL?{auto_model_routed_flash:1,auto_model_cascade_escalations:1,auto_model_cascade_reached_flash:1}:{}),...(input.route.routedModel===PRO_MODEL?{auto_model_routed_pro:1,auto_model_cascade_escalations:2,auto_model_cascade_reached_flash:1,auto_model_cascade_reached_pro:1}:{}),
    ...(input.route.evidenceState==='complete'?{auto_evidence_complete:1}:{}),...(input.route.evidenceState==='unresolved'?{auto_evidence_unresolved:1}:{}),...(input.route.evidenceState==='conflict'?{auto_evidence_conflict:1}:{}),...(input.route.evidenceState==='no_evidence'?{auto_evidence_none:1}:{}),
  }
  await admin.from('assistant_turns').update({usage:addUsage(numericUsage(turn.usage),routeUsage)}).eq('id',turn.id)
}

function proxyStream(upstream:Response, route:RouteDecision|null, persist:()=>Promise<void>) {
  if(!upstream.body)return upstream
  const headers=new Headers(streamHeaders)
  if(route){headers.set('x-jetwork-auto-route',route.routedModel);headers.set('x-jetwork-auto-evidence',route.evidenceState)}
  const reader=upstream.body.getReader()
  const stream=new ReadableStream<Uint8Array>({async start(controller){let closed=false;try{while(true){const{done,value}=await reader.read();if(done)break;if(value&&!closed){try{controller.enqueue(value)}catch{closed=true}}}}catch(error){if(!closed)try{controller.error(error)}catch{}}finally{if(!closed)try{controller.close()}catch{};const work=persist().catch(()=>undefined);const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil)runtime.waitUntil(work);else void work}}})
  return new Response(stream,{status:upstream.status,headers})
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return jsonResponse({error:'Only POST is supported.'},405)
  const authorization=req.headers.get('Authorization')||''
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||''
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY')||''
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  const geminiApiKey=Deno.env.get('GEMINI_API_KEY')||''
  if(!authorization||!supabaseUrl||!anonKey)return jsonResponse({error:'Authentication is required.'},401)
  let body:Record<string,any>;try{const parsed=await req.json();body=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}}catch{return jsonResponse({error:'Request body is invalid.'},400)}
  const requestedModel=clean(body.model||AUTO_MODEL,80)
  const workspaceId=clean(body.workspaceId,200)
  const messageId=clean(body.messageId,240)
  let forwardedBody=body
  let route:RouteDecision|null=null
  const client=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  if(requestedModel===AUTO_MODEL){
    if(!geminiApiKey)return jsonResponse({error:'GEMINI_API_KEY is required for Auto routing.',code:'AUTO_ROUTER_UNAVAILABLE'},503)
    const message=clean(body.message,32000)
    const [context,evidence]=await Promise.all([loadCompactContext(client,workspaceId,messageId),inspectEvidence(client,workspaceId,message).catch(()=>({state:'none' as EvidenceState,identifiers:[],direct:0,references:0,relations:0,conflicts:0}))])
    try{route=await routeAuto({apiKey:geminiApiKey,message,context,attachments:Array.isArray(body.chatAttachments)?body.chatAttachments.slice(0,3):[],evidence})}
    catch(error){console.warn('PRIMARY_BRIDGE_AUTO_ROUTER_FAILED_KEEP_FLASH',String(error).slice(0,500));route={routedModel:FLASH_MODEL,decision:'USE_FLASH',usage:{inputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,estimatedCostUsd:0},evidenceState:evidence.state,reasons:['router_error_flash_fallback']}}
    forwardedBody={...body,model:route.routedModel}
    console.info('PRIMARY_BRIDGE_EVIDENCE_ROUTE',JSON.stringify({version:ROUTER_VERSION,messageId,workspaceId,routedModel:route.routedModel,decision:route.decision,evidenceState:route.evidenceState,reasons:route.reasons}))
  }
  let upstream:Response
  try{upstream=await fetch(`${supabaseUrl}/functions/v1/openai-assistant`,{method:'POST',headers:{Authorization:authorization,apikey:anonKey,'Content-Type':'application/json','x-client-info':`jetwork-${ROUTER_VERSION}`},body:JSON.stringify(forwardedBody)})}
  catch{return jsonResponse({error:'Asistan servisine bağlanılamadı. Lütfen tekrar deneyin.',code:'PRIMARY_AGENT_UNREACHABLE'},502)}
  if(!upstream.ok||!upstream.body){const bytes=await upstream.arrayBuffer().catch(()=>new ArrayBuffer(0));return new Response(bytes,{status:upstream.status||502,headers:{...corsHeaders,'Content-Type':upstream.headers.get('Content-Type')||'application/json'}})}
  return proxyStream(upstream,route,()=>route&&serviceRoleKey?persistRouteTelemetry({supabaseUrl,serviceRoleKey,workspaceId,messageId,route}):Promise.resolve())
})
