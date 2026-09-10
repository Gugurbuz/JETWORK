import { describe, expect, it } from 'vitest'
import {
  buildPublicWorkProtocolInstruction,
  gateGeminiAgentToolsForPublicWork,
  hasCompletedPublicWorkStart,
  hasEmptyDiscoveryObservationSinceLastProgress,
} from '../../../supabase/functions/_shared/agent/publicWorkProtocol'
import {
  REPORT_PROGRESS_TOOL,
  buildControllerCapabilitySurface,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface'

const tools = buildControllerCapabilitySurface().tools

const startTrace = [
  {
    type: 'function_call',
    call_id: 'call_start',
    name: 'report_progress',
    arguments: JSON.stringify({
      kind: 'start',
      message: 'Bunu Enerjisa teklif ve maliyet akışı bağlamında ele alıyorum; önce costing/fixing kullanımını, sonra ilişkili teknik akışı kontrol edeceğim.',
      resolvedGoal: 'Enerjisa kurumsal satış sürecinde cost alma ve fixing kavramlarının gerçek anlamını ve akışını açıklamak',
      planSteps: [
        'Cost/costing kullanımını kurumsal kaynaklarda bul',
        'Fixing kullanımını ve ön koşullarını kontrol et',
        'Ninja veya ilgili teknik akışla bağı varsa exact kaynağa in',
        'Bulguları karşılaştırıp sentezle',
      ],
      evidenceGaps: ['Cost ile fixing arasındaki teknik bağ henüz doğrulanmadı'],
      sourceRefs: null,
    }),
  },
  {
    type: 'function_call_output',
    call_id: 'call_start',
    output: JSON.stringify({ ok: true, sequence: 1, kind: 'start' }),
  },
]

describe('Agent public work protocol', () => {
  it('gates Gemini substantive tools until the model has published a completed start plan', () => {
    const before = gateGeminiAgentToolsForPublicWork([], tools, true)
    expect(before.started).toBe(false)
    expect(before.providerWebEnabled).toBe(false)
    expect(before.tools.map(tool => tool.name)).toEqual(['report_progress'])

    const after = gateGeminiAgentToolsForPublicWork(startTrace, tools, true)
    expect(after.started).toBe(true)
    expect(after.providerWebEnabled).toBe(true)
    expect(after.tools.map(tool => tool.name)).toEqual(tools.map(tool => tool.name))
  })

  it('requires a successful report_progress start output rather than trusting an unexecuted model call', () => {
    expect(hasCompletedPublicWorkStart(startTrace.slice(0, 1))).toBe(false)
    expect(hasCompletedPublicWorkStart(startTrace)).toBe(true)
  })

  it('turns the start tool into structured resolved-goal/work-plan state instead of a status-only string', () => {
    expect(REPORT_PROGRESS_TOOL.strict).toBe(true)
    const parameters = REPORT_PROGRESS_TOOL.parameters as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(new Set(parameters.required)).toEqual(new Set([
      'kind',
      'message',
      'resolvedGoal',
      'planSteps',
      'evidenceGaps',
      'sourceRefs',
    ]))
    expect(parameters.properties.resolvedGoal).toBeTruthy()
    expect(parameters.properties.planSteps).toBeTruthy()
    expect(parameters.properties.evidenceGaps).toBeTruthy()
  })

  it('does not let one empty enterprise discovery become a source-absence conclusion', () => {
    const items = [
      ...startTrace,
      {
        type: 'function_call',
        call_id: 'call_search',
        name: 'search_knowledge_catalog',
        arguments: JSON.stringify({ query: 'Cost fix', objectTypes: ['document'], limit: 5 }),
      },
      {
        type: 'function_call_output',
        call_id: 'call_search',
        output: JSON.stringify({ resultCount: 0, candidateSourceCount: 0, citationReady: false }),
      },
    ]

    expect(hasEmptyDiscoveryObservationSinceLastProgress(items)).toBe(true)
    const instruction = buildPublicWorkProtocolInstruction(items, true)
    expect(instruction).toContain('Tek boş sorguyu "kurumsal kaynak yok" sonucu sayma')
    expect(instruction).toContain('kavramsal olarak farklı')
    expect(instruction).toContain('report_progress(kind=plan_change)')
  })

  it('keeps direct answers possible only through an explicit first-turn model decision', () => {
    const instruction = buildPublicWorkProtocolInstruction([], true)
    expect(instruction).toContain('gerçekten hiçbir JetWork capability/kurumsal kaynak gerekmiyorsa `answer_directly`')
    expect(instruction).toContain('araştırma, kurumsal bağlam çözümü veya teknik doğrulama gerekiyorsa `report_progress(kind=start)`')
    expect(instruction).toContain('Açıklaması verilmemiş kısaltma, ürün/kod, class/method/message identifier')
    expect(instruction).toContain('aktif sistem/çalışma/konuşma bağlamıyla çözdüğün gerçek hedefi')
  })
})