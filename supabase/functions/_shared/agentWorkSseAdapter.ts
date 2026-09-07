export type PublicAgentWorkState = 'pending' | 'active' | 'completed' | 'warning' | 'failed'
export type PublicAgentWorkKind = 'status' | 'commentary' | 'tool' | 'source' | 'artifact' | 'warning' | 'final'

export interface PublicAgentWorkEvent {
  event_id: string
  sequence: number
  kind: PublicAgentWorkKind
  label: string
  tool?: string
  source_type?: string
  started_at: string
  completed_at?: string
  state: PublicAgentWorkState
}

interface PublicSourceSummary {
  label: string
  sourceType: 'knowledge' | 'web' | 'media' | 'runtime'
  tool: string
}

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)
const frame = (eventName: string, payload: unknown) => `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`

const parseFrame = (input: string): { eventName: string; payload: Record<string, unknown> | null; data: string } => {
  const eventName = input.split(/\r?\n/u).find(line => line.startsWith('event:'))?.slice(6).trim() || ''
  const data = input.split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /u, ''))
    .join('\n')
  if (!data || data === '[DONE]') return { eventName, payload: null, data }
  try {
    const parsed = JSON.parse(data)
    return { eventName, payload: parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null, data }
  } catch {
    return { eventName, payload: null, data }
  }
}

const publicLabel = (value: unknown, completed = false) => {
  const label = clean(value, 1_000)
  if (!label) return ''
  if (/^talep bağlamı çıkarılıyor/iu.test(label) || /^soru ve konuşma bağlamını hazırlıyorum/iu.test(label)) return completed ? 'Soru ve konuşma bağlamı hazırlandı' : 'Soru ve konuşma bağlamını hazırlıyorum...'
  if (/^advisory bağlam hazırlanıyor/iu.test(label) || /^ilgili proje bağlamını topluyorum/iu.test(label)) return completed ? 'İlgili proje bağlamı hazırlandı' : 'İlgili proje bağlamını topluyorum...'
  if (/^semantic capability adayları çıkarılıyor/iu.test(label) || /^uygun kaynak ve araçları değerlendiriyorum/iu.test(label)) return completed ? 'Uygun kaynak ve araçlar değerlendirildi' : 'Uygun kaynak ve araçları değerlendiriyorum...'
  if (/^controller hazır:/iu.test(label) || /^çalışma araçlarını hazırlıyorum/iu.test(label)) return completed ? 'Çalışma araçları hazırlandı' : 'Çalışma araçlarını hazırlıyorum...'
  if (/^controller ek capability\/kanıt çağrısı yapıyor/iu.test(label) || /^bulduğum bilgiyi ek kaynaklarla doğruluyorum/iu.test(label)) return completed ? 'Bulduğum bilgi ek kaynaklarla doğrulandı' : 'Bulduğum bilgiyi ek kaynaklarla doğruluyorum...'
  if (/^controller ilgili jetwork skill prosedürlerini yüklüyor/iu.test(label) || /^gerekli çalışma yöntemini hazırlıyorum/iu.test(label)) return completed ? 'Gerekli çalışma yöntemi hazırlandı' : 'Gerekli çalışma yöntemini hazırlıyorum...'
  if (/^yanıt hazırlandı/iu.test(label) || /^yanıt oluşturuluyor/iu.test(label)) return completed ? 'Yanıt oluşturuldu' : 'Yanıt oluşturuluyor...'
  if (!completed) return label
  return label
    .replace(/inceleniyor/giu, 'incelendi')
    .replace(/taranıyor/giu, 'tarandı')
    .replace(/aranıyor/giu, 'incelendi')
    .replace(/karşılaştırılıyor/giu, 'karşılaştırıldı')
    .replace(/doğrulanıyor/giu, 'doğrulandı')
    .replace(/hazırlanıyor/giu, 'hazırlandı')
    .replace(/oluşturuluyor/giu, 'oluşturuldu')
    .replace(/çalışıyor/giu, 'tamamlandı')
}

const sourceSummary = (payload: Record<string, unknown>): PublicSourceSummary | null => {
  const sources = Array.isArray(payload.sources) ? payload.sources as Record<string, unknown>[] : []
  let knowledge = 0
  let web = 0
  let media = 0
  for (const source of sources) {
    const sourceType = clean(source.sourceType || source.source_type, 40)
    if (sourceType === 'web') web += 1
    else if (sourceType === 'media') media += 1
    else if (sourceType === 'knowledge' || !sourceType) knowledge += 1
  }

  const categories = Number(knowledge > 0) + Number(web > 0) + Number(media > 0)
  if (categories === 0) return null
  if (categories === 1 && knowledge > 0) return { label: `${knowledge} kurumsal kaynak bulundu`, sourceType: 'knowledge', tool: 'Bilgi Bankası' }
  if (categories === 1 && web > 0) return { label: `${web} web kaynağı bulundu`, sourceType: 'web', tool: 'Web' }
  if (categories === 1 && media > 0) return { label: `${media} kullanıcı medyası incelendi`, sourceType: 'media', tool: 'Medya' }

  const parts = [
    knowledge > 0 ? `${knowledge} kurumsal kaynak` : '',
    web > 0 ? `${web} web kaynağı` : '',
    media > 0 ? `${media} kullanıcı medyası` : '',
  ].filter(Boolean)
  return {
    label: `${parts.join(' · ')} incelendi`,
    sourceType: 'runtime',
    tool: 'Kaynaklar',
  }
}

const sourceTypeForStage = (stage: string) => {
  if (stage === 'searching_knowledge') return 'knowledge'
  if (stage === 'searching_web') return 'web'
  return 'runtime'
}

const toolForStage = (stage: string) => {
  if (stage === 'searching_knowledge') return 'Bilgi Bankası'
  if (stage === 'searching_web') return 'Web'
  return undefined
}

export interface AgentWorkSseAdapter {
  transformFrame(input: string): string
  flush(): string
}

export function createAgentWorkSseAdapter(now: () => number = () => Date.now()): AgentWorkSseAdapter {
  let sequence = 0
  let activeActivity: PublicAgentWorkEvent | null = null
  let activeTool: PublicAgentWorkEvent | null = null
  const providerOperations = new Map<string, PublicAgentWorkEvent>()

  const timestamp = () => new Date(now()).toISOString()
  const nextSequence = () => {
    sequence += 1
    return sequence
  }
  const nextId = (kind: PublicAgentWorkKind) => `${kind}:${sequence + 1}`

  const completeActive = (state: 'completed' | 'failed' = 'completed') => {
    if (!activeActivity) return ''
    const completed: PublicAgentWorkEvent = {
      ...activeActivity,
      label: publicLabel(activeActivity.label, true),
      state,
      completed_at: timestamp(),
    }
    const completesTool = activeTool?.event_id === activeActivity.event_id
    activeActivity = null
    if (completesTool) activeTool = null
    return frame(completesTool ? 'tool_complete' : 'agent_activity', completed)
  }

  const startActivity = (input: Omit<PublicAgentWorkEvent, 'event_id' | 'sequence' | 'started_at' | 'state'>) => {
    const event: PublicAgentWorkEvent = {
      ...input,
      event_id: nextId(input.kind),
      sequence: nextSequence(),
      started_at: timestamp(),
      state: 'active',
    }
    activeActivity = event
    return event
  }

  const startDetachedTool = (input: { label: string; tool?: string; source_type?: string }) => ({
    kind: 'tool' as const,
    label: input.label,
    tool: input.tool,
    source_type: input.source_type,
    event_id: nextId('tool'),
    sequence: nextSequence(),
    started_at: timestamp(),
    state: 'active' as const,
  })

  const completedEvent = (input: Omit<PublicAgentWorkEvent, 'event_id' | 'sequence' | 'started_at' | 'completed_at' | 'state'>) => {
    const at = timestamp()
    return {
      ...input,
      event_id: nextId(input.kind),
      sequence: nextSequence(),
      started_at: at,
      completed_at: at,
      state: 'completed' as const,
    }
  }

  const transformFrame = (input: string): string => {
    const parsed = parseFrame(input)
    const eventName = clean(parsed.eventName, 80)
    const payload = parsed.payload
    if (!eventName || !payload || parsed.data === '[DONE]') return input
    if (eventName === 'text_delta') return input

    if (eventName === 'provider_step') {
      const operationId = clean(payload.operation_id, 500)
      const lifecycle = clean(payload.lifecycle, 20)
      if (!operationId || !['start', 'complete'].includes(lifecycle)) return ''

      if (lifecycle === 'start') {
        const prefix = completeActive()
        const started = startDetachedTool({
          label: publicLabel(payload.label, false) || 'Araç çalışıyor...',
          tool: clean(payload.tool, 120) || undefined,
          source_type: clean(payload.source_type, 40) || 'runtime',
        })
        providerOperations.set(operationId, started)
        return `${prefix}${frame('tool_start', started)}`
      }

      const started = providerOperations.get(operationId)
      if (!started) return ''
      providerOperations.delete(operationId)
      const failed = payload.failed === true
      const completed: PublicAgentWorkEvent = {
        ...started,
        label: publicLabel(payload.label || started.label, true),
        state: failed ? 'failed' : 'completed',
        completed_at: timestamp(),
      }
      return frame('tool_complete', completed)
    }

    if (eventName === 'status') {
      const stage = clean(payload.stage, 80)
      const label = publicLabel(payload.label, false)
      const prefix = completeActive()
      const tool = toolForStage(stage)
      const sourceType = sourceTypeForStage(stage)
      const activity = startActivity({ kind: tool ? 'tool' : 'status', label, tool, source_type: sourceType })
      if (tool) activeTool = activity
      const enriched = { ...payload, event_id: activity.event_id, sequence: activity.sequence, kind: activity.kind, label, tool, source_type: sourceType, started_at: activity.started_at, state: activity.state }
      return `${prefix}${frame('status', enriched)}${frame(tool ? 'tool_start' : 'agent_activity', activity)}`
    }

    if (eventName === 'commentary') {
      const prefix = completeActive()
      const label = publicLabel(payload.message || payload.label, false)
      const activity = startActivity({ kind: 'commentary', label, source_type: 'runtime' })
      const enriched = { ...payload, event_id: activity.event_id, sequence: activity.sequence, label, started_at: activity.started_at, state: activity.state }
      return `${prefix}${frame('commentary', enriched)}${frame('agent_activity', activity)}`
    }

    if (eventName === 'sources') {
      let prefix = ''
      if (activeTool) {
        const completedTool: PublicAgentWorkEvent = {
          ...activeTool,
          label: publicLabel(activeTool.label, true),
          state: 'completed',
          completed_at: timestamp(),
        }
        prefix += frame('tool_complete', completedTool)
        if (activeActivity?.event_id === activeTool.event_id) activeActivity = null
        activeTool = null
      }
      const summary = sourceSummary(payload)
      if (!summary) return `${prefix}${input}`
      const sourceEvent = completedEvent({ kind: 'source', label: summary.label, tool: summary.tool, source_type: summary.sourceType })
      return `${prefix}${frame('sources', { ...payload, event_id: sourceEvent.event_id, sequence: sourceEvent.sequence, label: sourceEvent.label, source_type: sourceEvent.source_type, started_at: sourceEvent.started_at, completed_at: sourceEvent.completed_at, state: sourceEvent.state })}${frame('agent_activity', sourceEvent)}`
    }

    if (eventName === 'artifacts') {
      const artifactEvent = completedEvent({ kind: 'artifact', label: 'Çalışma çıktısı hazırlandı', tool: 'Dosya', source_type: 'artifact' })
      return `${input}${frame('artifact', { ...artifactEvent, artifacts: payload.artifacts })}`
    }

    if (eventName === 'completed') {
      let prefix = completeActive()
      activeTool = null
      for (const [operationId, started] of providerOperations) {
        prefix += frame('tool_complete', {
          ...started,
          label: publicLabel(started.label, true),
          state: 'completed',
          completed_at: timestamp(),
        })
        providerOperations.delete(operationId)
      }
      const finalEvent = completedEvent({ kind: 'final', label: 'Yanıt oluşturuldu', source_type: 'runtime' })
      return `${prefix}${frame('final', { ...finalEvent, conversationId: payload.conversationId, model: payload.model, provider: payload.provider })}${input}`
    }

    if (eventName === 'error') {
      let prefix = completeActive('failed')
      activeTool = null
      for (const [operationId, started] of providerOperations) {
        prefix += frame('tool_complete', {
          ...started,
          label: `${started.tool || 'Araç'} işlemi tamamlanamadı`,
          state: 'failed',
          completed_at: timestamp(),
        })
        providerOperations.delete(operationId)
      }
      const warningEvent = completedEvent({ kind: 'warning', label: clean(payload.message || payload.error, 1_000) || 'Çalışma sırasında bir hata oluştu', source_type: 'runtime' })
      return `${prefix}${frame('warning', { ...warningEvent, state: 'failed' })}${input}`
    }

    if (eventName === 'tool_start' || eventName === 'tool_complete' || eventName === 'artifact' || eventName === 'warning' || eventName === 'final' || eventName === 'agent_activity') return input
    return input
  }

  const flush = () => {
    let output = completeActive()
    for (const [operationId, started] of providerOperations) {
      output += frame('tool_complete', {
        ...started,
        label: publicLabel(started.label, true),
        state: 'completed',
        completed_at: timestamp(),
      })
      providerOperations.delete(operationId)
    }
    return output
  }

  return { transformFrame, flush }
}
