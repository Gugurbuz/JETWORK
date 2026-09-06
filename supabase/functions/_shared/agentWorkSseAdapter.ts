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
  if (/^talep bağlamı çıkarılıyor/iu.test(label)) return completed ? 'Soru ve konuşma bağlamı hazırlandı' : 'Soru ve konuşma bağlamını hazırlıyorum...'
  if (/^advisory bağlam hazırlanıyor/iu.test(label)) return completed ? 'İlgili proje bağlamı hazırlandı' : 'İlgili proje bağlamını topluyorum...'
  if (/^semantic capability adayları çıkarılıyor/iu.test(label)) return completed ? 'Uygun kaynak ve araçlar değerlendirildi' : 'Uygun kaynak ve araçları değerlendiriyorum...'
  if (/^controller hazır:/iu.test(label)) return completed ? 'Çalışma araçları hazırlandı' : 'Çalışma araçlarını hazırlıyorum...'
  if (/^controller ek capability\/kanıt çağrısı yapıyor/iu.test(label)) return completed ? 'Bulduğum bilgi ek kaynaklarla doğrulandı' : 'Bulduğum bilgiyi ek kaynaklarla doğruluyorum...'
  if (/^controller ilgili jetwork skill prosedürlerini yüklüyor/iu.test(label)) return completed ? 'Gerekli çalışma yöntemi hazırlandı' : 'Gerekli çalışma yöntemini hazırlıyorum...'
  if (/^yanıt hazırlandı/iu.test(label)) return completed ? 'Yanıt oluşturuldu' : 'Yanıt oluşturuluyor...'
  if (!completed) return label
  return label
    .replace(/inceleniyor/giu, 'incelendi')
    .replace(/taranıyor/giu, 'tarandı')
    .replace(/aranıyor/giu, 'incelendi')
    .replace(/karşılaştırılıyor/giu, 'karşılaştırıldı')
    .replace(/doğrulanıyor/giu, 'doğrulandı')
    .replace(/hazırlanıyor/giu, 'hazırlandı')
    .replace(/oluşturuluyor/giu, 'oluşturuldu')
}

const sourceSummary = (payload: Record<string, unknown>) => {
  const sources = Array.isArray(payload.sources) ? payload.sources as Record<string, unknown>[] : []
  const knowledge = sources.filter(source => clean(source.sourceType || source.source_type, 40) !== 'web').length
  const web = sources.filter(source => clean(source.sourceType || source.source_type, 40) === 'web').length
  if (knowledge > 0 && web > 0) return `${knowledge} kurumsal ve ${web} web kaynağı bulundu`
  if (knowledge > 0) return `${knowledge} kurumsal kaynak bulundu`
  if (web > 0) return `${web} web kaynağı bulundu`
  return ''
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
    activeActivity = null
    return frame('agent_activity', completed)
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
      const label = sourceSummary(payload)
      if (!label) return `${prefix}${input}`
      const sourceType = /web kaynağı/iu.test(label) && !/kurumsal/iu.test(label) ? 'web' : 'knowledge'
      const sourceEvent = completedEvent({ kind: 'source', label, tool: sourceType === 'web' ? 'Web' : 'Bilgi Bankası', source_type: sourceType })
      return `${prefix}${frame('sources', { ...payload, event_id: sourceEvent.event_id, sequence: sourceEvent.sequence, label: sourceEvent.label, source_type: sourceEvent.source_type, started_at: sourceEvent.started_at, completed_at: sourceEvent.completed_at, state: sourceEvent.state })}${frame('agent_activity', sourceEvent)}`
    }

    if (eventName === 'artifacts') {
      const artifactEvent = completedEvent({ kind: 'artifact', label: 'Çalışma çıktısı hazırlandı', tool: 'Dosya', source_type: 'artifact' })
      return `${input}${frame('artifact', { ...artifactEvent, artifacts: payload.artifacts })}`
    }

    if (eventName === 'completed') {
      const prefix = completeActive()
      activeTool = null
      const finalEvent = completedEvent({ kind: 'final', label: 'Yanıt oluşturuldu', source_type: 'runtime' })
      return `${prefix}${frame('final', { ...finalEvent, conversationId: payload.conversationId, model: payload.model, provider: payload.provider })}${input}`
    }

    if (eventName === 'error') {
      const prefix = completeActive('failed')
      activeTool = null
      const warningEvent = completedEvent({ kind: 'warning', label: clean(payload.message || payload.error, 1_000) || 'Çalışma sırasında bir hata oluştu', source_type: 'runtime' })
      return `${prefix}${frame('warning', { ...warningEvent, state: 'failed' })}${input}`
    }

    if (eventName === 'tool_start' || eventName === 'tool_complete' || eventName === 'artifact' || eventName === 'warning' || eventName === 'final' || eventName === 'agent_activity') {
      return input
    }

    return input
  }

  const flush = () => completeActive()
  return { transformFrame, flush }
}
