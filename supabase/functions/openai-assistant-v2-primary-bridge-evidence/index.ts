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
  'X-JetWork-Primary-Agent-Bridge': 'v5-runtime-evidence-source-focus',
}

const AUTO_MODEL = 'auto'
const LITE_MODEL = 'gemini-3.5-flash-lite'
const FLASH_MODEL = 'gemini-3.5-flash'
const PRO_MODEL = 'gemini-3.1-pro-preview'
const ROUTER_VERSION = 'primary-bridge-runtime-evidence-v5'
const MAX_CONTEXT_MESSAGES = 6
const MAX_CONTEXT_CHARS = 3_000
const TECHNICAL_IDENTIFIER = /\b(?:Z[A-Z0-9_/-]{2,}(?:-\d+)?|CHECK_[A-Z0-9_]+)\b/gu

type RoutedModel = typeof LITE_MODEL | typeof FLASH_MODEL | typeof PRO_MODEL
type EvidenceState = 'deferred'
type RouterUsage = { inputTokens:number; outputTokens:number; reasoningTokens:number; totalTokens:number; estimatedCostUsd:number }
type RouteDecision = {
  routedModel: RoutedModel
  decision: 'USE_LITE' | 'USE_FLASH' | 'USE_PRO'
  usage: RouterUsage
  evidenceState: EvidenceState
  reasons: string[]
}
type SourceRef = { sourceId?:string; sourceName?:string; canonicalKey?:string; objectType?:string; title?:string; [key:string]:unknown }

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const escapeRegex = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
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

async function routeAuto(input:{apiKey:string;message:string;context:string;attachments:any[]}):Promise<RouteDecision> {
  const ai = new GoogleGenAI({apiKey:input.apiKey})
  const identifiers = unique([...input.message.toLocaleUpperCase('en-US').matchAll(TECHNICAL_IDENTIFIER)].map(match=>match[0])).slice(0,6)
  const prompt = [
    `Current user request:\n${clean(input.message,3000)}`,
    input.context ? `Recent conversation context (continuity only, not evidence):\n${input.context}` : '',
    input.attachments.length ? `Attachments: ${input.attachments.slice(0,3).map(item=>`${clean(item?.name,120)} (${clean(item?.mimeType,80)})`).join(', ')}` : '',
    identifiers.length ? `Technical identifiers present in the request: ${identifiers.join(', ')}` : '',
    'Enterprise evidence availability is intentionally deferred to the runtime retrieval phase.',
  ].filter(Boolean).join('\n\n')
  const response = await ai.models.generateContent({
    model:LITE_MODEL,
    contents:[{role:'user',parts:[{text:prompt}]}],
    config:{
      systemInstruction:[
        'You are the JetWork initial model routing gate. Do not answer the user.',
        'Output exactly one token: USE_LITE, USE_FLASH, or USE_PRO.',
        'Route only from semantic task complexity, conversation context, and attachment complexity. Do not guess whether enterprise evidence exists; retrieval happens after this routing step.',
        'Prefer USE_LITE for routine direct lookups, straightforward follow-ups, and narrow factual requests.',
        'Choose USE_FLASH for multi-part synthesis, broader comparisons, or requests that materially benefit from stronger synthesis before evidence is known.',
        'Choose USE_PRO only for unusually difficult, ambiguous, high-constraint reasoning tasks.',
        'An exact identifier may start on any tier justified by semantic complexity, but it is never permanently locked to a tier.',
        'The runtime will independently escalate Lite to Flash or Pro after verified evidence is retrieved, so do not pre-escalate merely because evidence might be complex.',
      ].join(' '), temperature:0, maxOutputTokens:16,
    },
  } as any)
  const raw = responseText(response).toUpperCase()
  const decision:RouteDecision['decision'] = raw === 'USE_LITE' ? 'USE_LITE' : raw === 'USE_PRO' ? 'USE_PRO' : 'USE_FLASH'
  const routedModel:RoutedModel = decision === 'USE_LITE' ? LITE_MODEL : decision === 'USE_PRO' ? PRO_MODEL : FLASH_MODEL
  return { routedModel, decision, usage:routerUsage(response), evidenceState:'deferred', reasons:[`semantic_classifier_${decision.toLocaleLowerCase('en-US')}`,'evidence_deferred_to_runtime'] }
}

const numericUsage = (value:unknown) => { const out:Record<string,number>={}; if(!value||typeof value!=='object'||Array.isArray(value))return out; for(const[k,v]of Object.entries(value as Record<string,unknown>)){const n=Number(v);if(Number.isFinite(n))out[k]=n}return out }
const addUsage = (...values:Array<Record<string,number>|undefined>) => { const out:Record<string,number>={}; for(const value of values)for(const[k,n]of Object.entries(value||{}))if(Number.isFinite(n))out[k]=(out[k]||0)+n; return out }
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

async function alignAutoConversationModel(input:{supabaseUrl:string;serviceRoleKey:string;workspaceId:string;routedModel:RoutedModel}) {
  if(!input.workspaceId||!input.serviceRoleKey)return
  const admin=createClient(input.supabaseUrl,input.serviceRoleKey,{auth:{persistSession:false}})
  const { error } = await admin.from('assistant_conversations').update({model:input.routedModel}).eq('workspace_id',input.workspaceId).eq('status','active').neq('model',input.routedModel)
  if(error)throw error
}

async function persistRouteTelemetry(input:{supabaseUrl:string;serviceRoleKey:string;workspaceId:string;messageId:string;route:RouteDecision}) {
  if(!input.workspaceId||!input.messageId)return
  const admin=createClient(input.supabaseUrl,input.serviceRoleKey,{auth:{persistSession:false}})
  let turn:any=null
  for(const delayMs of [0,100,300,800,1500]){if(delayMs)await sleep(delayMs);const{data}=await admin.from('assistant_turns').select('id,usage').eq('workspace_id',input.workspaceId).eq('message_id',input.messageId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(data?.id){turn=data;break}}
  if(!turn?.id)return
  const routeUsage={
    input_tokens:input.route.usage.inputTokens,output_tokens:input.route.usage.outputTokens,reasoning_tokens:input.route.usage.reasoningTokens,total_tokens:input.route.usage.totalTokens,estimated_cost_usd:input.route.usage.estimatedCostUsd,
    primary_llm_router_calls:1,auto_model_cascade_started:1,auto_model_router_calls:1,auto_evidence_deferred_to_runtime:1,
    ...(input.route.routedModel===LITE_MODEL?{auto_model_routed_lite:1}:{}),
    ...(input.route.routedModel===FLASH_MODEL?{auto_model_routed_flash:1,auto_model_cascade_escalations:1,auto_model_cascade_reached_flash:1}:{}),
    ...(input.route.routedModel===PRO_MODEL?{auto_model_routed_pro:1,auto_model_cascade_escalations:2,auto_model_cascade_reached_flash:1,auto_model_cascade_reached_pro:1}:{}),
  }
  await admin.from('assistant_turns').update({usage:addUsage(numericUsage(turn.usage),routeUsage)}).eq('id',turn.id)
}

const sourceKey=(source:SourceRef)=>[source.sourceId||'',source.canonicalKey||'',source.sourceName||'',source.title||''].join('|')
const uniqueSources=(sources:SourceRef[])=>{const seen=new Set<string>();return sources.filter(source=>{const key=sourceKey(source);if(seen.has(key))return false;seen.add(key);return true})}
const sourceIdentifiers=(source:SourceRef)=>{
  const values:string[]=[]
  const canonical=clean(source.canonicalKey,400)
  if(canonical.includes(':')){
    const tail=canonical.slice(canonical.indexOf(':')+1).toLocaleUpperCase('en-US')
    if(tail)values.push(tail)
    const leaf=tail.split('/').pop()||''
    if(leaf)values.push(leaf)
  }
  const title=clean(source.title,500).toLocaleUpperCase('en-US')
  values.push(...[...title.matchAll(TECHNICAL_IDENTIFIER)].map(match=>match[0]))
  return unique(values.filter(value=>value.length>=3))
}
const answerMentionsIdentifier=(answer:string,identifier:string)=>{
  const normalized=answer.toLocaleUpperCase('en-US')
  const escaped=escapeRegex(identifier.toLocaleUpperCase('en-US'))
  return new RegExp(`(^|[^A-Z0-9_-]|/)${escaped}(?=$|->|[^A-Z0-9_-]|/)`,'u').test(normalized)
}
const focusSourcesForAnswer=(sources:SourceRef[],answer:string)=>{
  const deduped=uniqueSources(sources)
  const matched=deduped.filter(source=>sourceIdentifiers(source).some(identifier=>answerMentionsIdentifier(answer,identifier)))
  return matched.length?matched:deduped
}

const encodeFrame=(encoder:TextEncoder,event:string,payload:unknown)=>encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
const parseFrame=(frame:string)=>{
  const event=frame.split(/\r?\n/).find(line=>line.startsWith('event:'))?.slice(6).trim()||''
  const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n')
  if(!data||data==='[DONE]')return {event,data,payload:null as any}
  try{return {event,data,payload:JSON.parse(data)}}catch{return {event,data,payload:null as any}}
}

function proxyStream(upstream:Response, route:RouteDecision|null, persist:()=>Promise<void>) {
  if(!upstream.body)return upstream
  const headers=new Headers(streamHeaders)
  if(route){headers.set('x-jetwork-auto-route',route.routedModel);headers.set('x-jetwork-auto-evidence',route.evidenceState)}
  const reader=upstream.body.getReader()
  const decoder=new TextDecoder()
  const encoder=new TextEncoder()
  const stream=new ReadableStream<Uint8Array>({async start(controller){
    let closed=false,buffer='',answer=''
    let sources:SourceRef[]=[]
    let focusedSourcesSent=false
    const emitRaw=(frame:string)=>{if(!closed)try{controller.enqueue(encoder.encode(`${frame}\n\n`))}catch{closed=true}}
    const handleFrame=(frame:string)=>{
      if(!frame.trim())return
      const parsed=parseFrame(frame)
      const payload=parsed.payload
      if(payload?.type==='sources'||parsed.event==='sources'){
        if(Array.isArray(payload?.sources))sources=uniqueSources([...sources,...payload.sources])
        return
      }
      if(payload?.type==='text_delta'&&typeof payload?.delta==='string')answer+=payload.delta
      if((payload?.type==='completed'||parsed.event==='completed')&&!focusedSourcesSent&&sources.length){
        const focused=focusSourcesForAnswer(sources,answer)
        if(!closed)try{controller.enqueue(encodeFrame(encoder,'sources',{type:'sources',sources:focused}))}catch{closed=true}
        focusedSourcesSent=true
      }
      emitRaw(frame)
    }
    try{
      while(true){const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const parts=buffer.split(/\r?\n\r?\n/u);buffer=parts.pop()||'';parts.forEach(handleFrame)}
      buffer+=decoder.decode();if(buffer.trim())handleFrame(buffer)
      if(!focusedSourcesSent&&sources.length&&!closed){const focused=focusSourcesForAnswer(sources,answer);try{controller.enqueue(encodeFrame(encoder,'sources',{type:'sources',sources:focused}))}catch{closed=true}}
    }catch(error){if(!closed)try{controller.error(error)}catch{}}
    finally{if(!closed)try{controller.close()}catch{};const work=persist().catch(()=>undefined);const runtime=(globalThis as any).EdgeRuntime;if(runtime?.waitUntil)runtime.waitUntil(work);else void work}
  }})
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
    const context=await loadCompactContext(client,workspaceId,messageId)
    try{route=await routeAuto({apiKey:geminiApiKey,message,context,attachments:Array.isArray(body.chatAttachments)?body.chatAttachments.slice(0,3):[]})}
    catch(error){console.warn('PRIMARY_BRIDGE_AUTO_ROUTER_FAILED_KEEP_FLASH',String(error).slice(0,500));route={routedModel:FLASH_MODEL,decision:'USE_FLASH',usage:{inputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,estimatedCostUsd:0},evidenceState:'deferred',reasons:['router_error_flash_fallback','evidence_deferred_to_runtime']}}
    forwardedBody={...body,model:route.routedModel,autoRouted:true}
    if(serviceRoleKey){try{await alignAutoConversationModel({supabaseUrl,serviceRoleKey,workspaceId,routedModel:route.routedModel})}catch(error){console.warn('PRIMARY_BRIDGE_AUTO_CONVERSATION_ALIGN_FAILED',String(error).slice(0,500))}}
    console.info('PRIMARY_BRIDGE_RUNTIME_ROUTE',JSON.stringify({version:ROUTER_VERSION,messageId,workspaceId,routedModel:route.routedModel,decision:route.decision,evidenceState:route.evidenceState,reasons:route.reasons}))
  }
  let upstream:Response
  try{upstream=await fetch(`${supabaseUrl}/functions/v1/openai-assistant`,{method:'POST',headers:{Authorization:authorization,apikey:anonKey,'Content-Type':'application/json','x-client-info':`jetwork-${ROUTER_VERSION}`},body:JSON.stringify(forwardedBody)})}
  catch{return jsonResponse({error:'Asistan servisine bağlanılamadı. Lütfen tekrar deneyin.',code:'PRIMARY_AGENT_UNREACHABLE'},502)}
  if(!upstream.ok||!upstream.body){const bytes=await upstream.arrayBuffer().catch(()=>new ArrayBuffer(0));return new Response(bytes,{status:upstream.status||502,headers:{...corsHeaders,'Content-Type':upstream.headers.get('Content-Type')||'application/json'}})}
  return proxyStream(upstream,route,()=>route&&serviceRoleKey?persistRouteTelemetry({supabaseUrl,serviceRoleKey,workspaceId,messageId,route}):Promise.resolve())
})
