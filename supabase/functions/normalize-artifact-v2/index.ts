import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { enforceArtifactSourceFidelity } from '../_shared/artifactSourceFidelity.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const REQUIRED_MARKERS = [
  'İş Analizi Dokümanı',
  'Talep Adı',
  'İçindekiler',
  '# İHTİYAÇ ANALİZİ',
  '## 1. ANALİZ KAPSAMI',
  '## 2. KISALTMALAR',
  '## 3. İŞ GEREKSİNİMLERİ',
  '## 4. FONKSİYONEL GEREKSİNİMLER (FR)',
  '## 5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)',
  '## 6. SÜREÇ RİSK ANALİZİ',
  '## 7. ONAY',
  '## 8. FONKSİYONEL TASARIM DOKÜMANLARI',
] as const

const normalizeText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

function repairCover(rawText: string): string {
  if (!rawText.trim()) return rawText
  const normalizedCover = normalizeText(rawText.slice(0, 1200))
  if (normalizedCover.includes('talep adi')) return rawText

  const coverPattern = /(\|\s*İş Analizi Dokümanı\s*\|\s*)([^|\n]+)(\s*\|\s*)\n(\s*\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|\s*)/iu
  const match = rawText.match(coverPattern)
  if (!match) return rawText
  const title = match[2].trim()
  if (!title) return rawText
  return rawText.replace(coverPattern, [
    '| İş Analizi Dokümanı | Talep Adı |',
    match[4],
    `| Talep Adı | ${title.replace(/\|/g, '\\|')} |`,
  ].join('\n'))
}

function parseArtifact(rawText: string) {
  const repaired = repairCover(rawText)
  const baMatch = repaired.match(/<ba_analysis>([\s\S]*?)<\/ba_analysis>/i)
  const reviewMatch = repaired.match(/<review>([\s\S]*?)<\/review>/i)
  const businessAnalysisMarkdown = (baMatch?.[1] || repaired)
    .replace(/<\/?ba_analysis>/gi, '')
    .replace(/<review>[\s\S]*?<\/review>/gi, '')
    .trim()
  const reviewMarkdown = (reviewMatch?.[1] || '').trim()
  const normalized = normalizeText(businessAnalysisMarkdown)
  const missingMarkers = REQUIRED_MARKERS.filter(marker => !normalized.includes(normalizeText(marker)))
  return {
    repairedRawText: repaired,
    businessAnalysisMarkdown,
    reviewMarkdown,
    missingMarkers,
  }
}

function replaceBusinessAnalysisBlock(rawText: string, markdown: string): string {
  if (/<ba_analysis>[\s\S]*?<\/ba_analysis>/i.test(rawText)) {
    return rawText.replace(
      /<ba_analysis>[\s\S]*?<\/ba_analysis>/i,
      `<ba_analysis>\n${markdown.trim()}\n</ba_analysis>`,
    )
  }
  return `<ba_analysis>\n${markdown.trim()}\n</ba_analysis>\n${rawText.trim()}`
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405)

  const authorization = req.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !anonKey) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })

  try {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user || authData.user.is_anonymous) {
      return jsonResponse({ error: 'A valid permanent user session is required.' }, 401)
    }

    const body = await req.json()
    const workspaceId = String(body?.workspaceId || '').trim().slice(0, 200)
    const taskId = String(body?.taskId || '').trim().slice(0, 200)
    const rawText = String(body?.rawText || '').slice(0, 220_000)
    const operation = body?.operation === 'revise' ? 'revise' : 'create'
    if (!workspaceId || !rawText) return jsonResponse({ error: 'workspaceId and rawText are required.' }, 400)

    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle()
    if (workspaceError || !workspace) return jsonResponse({ error: 'Workspace access denied.' }, 403)

    let sourceRequestText = ''
    if (taskId) {
      const { data: task, error: taskError } = await client
        .from('artifact_tasks')
        .select('request_text')
        .eq('id', taskId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (taskError) console.warn('Artifact source request could not be loaded:', taskError)
      sourceRequestText = String(task?.request_text || '').slice(0, 64_000)

      const { error } = await client.from('artifact_tasks').update({
        status: 'validating',
        last_transition_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', taskId).eq('workspace_id', workspaceId)
      if (error) console.warn('Artifact task validating transition failed:', error)
    }

    const parsed = parseArtifact(rawText)
    if (parsed.missingMarkers.length) {
      if (taskId) {
        await client.from('artifact_tasks').update({
          status: 'failed',
          error_message: `Eksik bölümler: ${parsed.missingMarkers.join(', ')}`.slice(0, 2000),
          last_transition_at: new Date().toISOString(),
        }).eq('id', taskId).eq('workspace_id', workspaceId)
      }
      return jsonResponse({
        error: 'Enerjisa doküman sözleşmesi doğrulanamadı.',
        missingMarkers: parsed.missingMarkers,
      }, 422)
    }

    const fidelity = enforceArtifactSourceFidelity(
      parsed.businessAnalysisMarkdown,
      sourceRequestText,
    )
    const normalizedRawText = replaceBusinessAnalysisBlock(
      parsed.repairedRawText,
      fidelity.markdown,
    )

    const artifact = {
      artifactType: 'business_analysis',
      operation,
      businessAnalysisMarkdown: fidelity.markdown,
      reviewMarkdown: parsed.reviewMarkdown,
      contractVersion: 'enerjisa-ba-v2-source-fidelity',
      validatedAt: new Date().toISOString(),
      sourceFidelity: {
        explicitProcessStepCount: fidelity.processSteps.length,
        injectedProcessStepCount: fidelity.injectedProcessSteps.length,
        explicitKpiFactCount: fidelity.kpiFacts.length,
        injectedKpiFactCount: fidelity.injectedKpiFacts.length,
        removedUnsupportedTechnicalLines: fidelity.removedUnsupportedTechnicalLines,
        replacedUnsupportedCommitments: fidelity.replacedUnsupportedCommitments,
      },
    }

    if (taskId) {
      const { error } = await client.from('artifact_tasks').update({
        status: 'persisting',
        artifact_payload: artifact,
        error_message: null,
        last_transition_at: new Date().toISOString(),
      }).eq('id', taskId).eq('workspace_id', workspaceId)
      if (error) throw error
    }

    return jsonResponse({ artifact, normalizedRawText, taskId: taskId || null })
  } catch (error) {
    console.error('Artifact normalizer failed:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Artifact normalization failed.' }, 500)
  }
})
