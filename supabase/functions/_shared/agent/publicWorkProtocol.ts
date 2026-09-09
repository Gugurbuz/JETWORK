export const PUBLIC_WORK_PROGRESS_TOOL_NAME = 'report_progress'
export const PUBLIC_WORK_PROTOCOL_VERSION = 'public-work-protocol-v1'

const SUBSTANTIVE_DISCOVERY_TOOLS = new Set([
  'search_knowledge_catalog',
  'search_document',
])

const clean = (value: unknown, max = 1_000) => String(value ?? '').trim().slice(0, max)

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const functionCallArguments = (item: Record<string, unknown>) => parseJsonObject(item.arguments) || {}

export const hasCompletedPublicWorkStart = (items: Array<Record<string, unknown>>): boolean => {
  const startCallIds = new Set<string>()
  for (const item of items) {
    if (String(item.type || '') !== 'function_call') continue
    if (String(item.name || '') !== PUBLIC_WORK_PROGRESS_TOOL_NAME) continue
    const args = functionCallArguments(item)
    if (String(args.kind || '') !== 'start') continue
    const callId = clean(item.call_id, 240)
    if (callId) startCallIds.add(callId)
  }
  if (!startCallIds.size) return false

  for (const item of items) {
    if (String(item.type || '') !== 'function_call_output') continue
    if (!startCallIds.has(clean(item.call_id, 240))) continue
    const output = parseJsonObject(item.output)
    if (output?.ok === true && String(output.kind || '') === 'start') return true
  }
  return false
}

const latestProgressOutputIndex = (items: Array<Record<string, unknown>>) => {
  const progressCallIds = new Set<string>()
  items.forEach(item => {
    if (String(item.type || '') === 'function_call' && String(item.name || '') === PUBLIC_WORK_PROGRESS_TOOL_NAME) {
      const callId = clean(item.call_id, 240)
      if (callId) progressCallIds.add(callId)
    }
  })
  let latest = -1
  items.forEach((item, index) => {
    if (String(item.type || '') === 'function_call_output' && progressCallIds.has(clean(item.call_id, 240))) latest = index
  })
  return latest
}

export const hasEmptyDiscoveryObservationSinceLastProgress = (items: Array<Record<string, unknown>>): boolean => {
  const namesByCallId = new Map<string, string>()
  const latestProgress = latestProgressOutputIndex(items)
  let empty = false

  items.forEach((item, index) => {
    const type = String(item.type || '')
    const callId = clean(item.call_id, 240)
    if (type === 'function_call') {
      namesByCallId.set(callId, String(item.name || ''))
      return
    }
    if (type !== 'function_call_output' || index <= latestProgress) return
    if (!SUBSTANTIVE_DISCOVERY_TOOLS.has(namesByCallId.get(callId) || '')) return
    const raw = typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
    if (/"resultCount"\s*:\s*0\b/.test(raw) || /"candidateSourceCount"\s*:\s*0\b/.test(raw)) empty = true
  })

  return empty
}

export const buildPublicWorkProtocolInstruction = (
  items: Array<Record<string, unknown>>,
  reportProgressAvailable = true,
): string => {
  if (!reportProgressAvailable) return ''
  const started = hasCompletedPublicWorkStart(items)
  if (!started) {
    return [
      '[JETWORK PUBLIC WORK GATE]',
      'Bir tool, kurumsal kaynak, web, skill veya artifact kullanmaya karar verirsen ilk ve bu turdaki tek function call `report_progress(kind=start)` olmalıdır.',
      '`start` çağrısında `resolvedGoal` alanına ham kullanıcı cümlesini tekrar etmek yerine aktif sistem/çalışma/konuşma bağlamıyla çözdüğün gerçek hedefi yaz; `planSteps` alanına 2-6 maddelik gerçek çalışma planını koy; `evidenceGaps` yalnız başlangıçta açık olan önemli belirsizlikleri içersin.',
      'Public `message` kısa ve doğal olmalı: ne anladığını ve neyi kontrol edeceğini kullanıcıya anlat. "Bilgi bankası sorgulanıyor", tool adı, provider telemetrysi veya gizli reasoning yazma.',
      'Bu turda araştırma gerekmiyorsa `report_progress` çağırmadan doğrudan cevap verebilirsin. Araştırma gerekiyorsa public start tamamlanmadan başka tool çağırma.',
      '[END JETWORK PUBLIC WORK GATE]',
    ].join('\n')
  }

  if (hasEmptyDiscoveryObservationSinceLastProgress(items)) {
    return [
      '[JETWORK OBSERVATION REPLAN REQUIRED]',
      'Son ranked discovery observationlarından en az biri boş döndü. Tek boş sorguyu "kurumsal kaynak yok" sonucu sayma.',
      'Kullanıcının gerçek hedefini, aktif sistem/çalışma bağlamını ve elindeki önceki observationları yeniden değerlendir. Aynı sorguyu eşanlamlılarla tekrarlamak yerine gerekiyorsa kavramsal olarak farklı ve daha anlamlı bir sorgu/capability seç; güçlü aday bulursan detail/source seviyesine in.',
      'Bu observation çalışma yaklaşımını maddi olarak değiştiriyorsa önce `report_progress(kind=plan_change)` ile neyin yetmediğini ve şimdi neye bakacağını kısa biçimde paylaş. Sonraki aksiyon ve durma kararı yine sana aittir.',
      '[END JETWORK OBSERVATION REPLAN REQUIRED]',
    ].join('\n')
  }

  return [
    '[JETWORK ACTIVE WORK LOOP]',
    'Public work start tamamlandı. Her observation sonrasında hedef için ne öğrendiğini, hangi maddi boşluğun kaldığını ve en değerli sonraki aksiyonu yeniden değerlendir.',
    'Anlamlı doğrulanmış bulguda `report_progress(kind=finding)`; yaklaşım gerçekten değiştiğinde `report_progress(kind=plan_change)` kullan. Her tool çağrısını anlatma. Yeterli kanıt oluştuğunda tool çağırmayı bırakıp sentezle.',
    '[END JETWORK ACTIVE WORK LOOP]',
  ].join('\n')
}

export const gateGeminiAgentToolsForPublicWork = <T extends { name?: unknown }>(
  items: Array<Record<string, unknown>>,
  tools: ReadonlyArray<T>,
  providerWebRequested: boolean,
) => {
  const reportProgressAvailable = tools.some(tool => String(tool.name || '') === PUBLIC_WORK_PROGRESS_TOOL_NAME)
  const started = !reportProgressAvailable || hasCompletedPublicWorkStart(items)
  const visibleTools: T[] = started
    ? [...tools]
    : tools.filter(tool => String(tool.name || '') === PUBLIC_WORK_PROGRESS_TOOL_NAME)

  return {
    version: PUBLIC_WORK_PROTOCOL_VERSION,
    reportProgressAvailable,
    started,
    tools: visibleTools,
    providerWebEnabled: providerWebRequested && started,
  }
}
