import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAgentWorkSseAdapter } from '../../../supabase/functions/_shared/agentWorkSseAdapter.ts'
import { createGeminiProviderStateItem } from '../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts'
import { compactPersistentConversationState } from '../../../supabase/functions/_shared/persistentConversationState.ts'

const frame = (event: string, payload: unknown) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`

const parseEvents = (wire: string) => wire
  .split(/\r?\n\r?\n/u)
  .filter(Boolean)
  .flatMap(raw => {
    const event = raw.split(/\r?\n/u).find(line => line.startsWith('event:'))?.slice(6).trim() || ''
    const data = raw.split(/\r?\n/u).find(line => line.startsWith('data:'))?.slice(5).trim() || ''
    if (!event || !data) return []
    return [{ event, payload: JSON.parse(data) as Record<string, unknown> }]
  })

describe('Controller V3 interaction state + Agent Work', () => {
  it('keeps the newest validated Gemini provider-state marker in durable conversation state', () => {
    const marker = createGeminiProviderStateItem('int_safe_final')
    const compacted = compactPersistentConversationState([
      { role: 'user', content: 'CHECK_ZTKS nedir?' },
      { role: 'assistant', content: 'Doğrulanmış cevap.' },
      marker,
    ])

    expect(compacted.at(-1)).toEqual(marker)
  })

  it('uses one canonical event id and sequence across real provider tool start/complete lifecycle', () => {
    let clock = Date.parse('2026-09-07T20:00:00.000Z')
    const adapter = createAgentWorkSseAdapter(() => clock)

    const startWire = adapter.transformFrame(frame('provider_step', {
      type: 'provider_step',
      operation_id: 'gemini:gs_1',
      lifecycle: 'start',
      label: 'Web kaynakları aranıyor...',
      tool: 'Web',
      source_type: 'web',
    }))
    clock += 1_000
    const completeWire = adapter.transformFrame(frame('provider_step', {
      type: 'provider_step',
      operation_id: 'gemini:gs_1',
      lifecycle: 'complete',
      label: 'Web kaynakları tarandı',
      tool: 'Web',
      source_type: 'web',
    }))

    const events = [...parseEvents(startWire), ...parseEvents(completeWire)]
    expect(events.map(item => item.event)).toEqual(['tool_start', 'tool_complete'])
    expect(events[0].payload.event_id).toBe(events[1].payload.event_id)
    expect(events[0].payload.sequence).toBe(events[1].payload.sequence)
    expect(events[0].payload.state).toBe('active')
    expect(events[1].payload.state).toBe('completed')
    expect(events[1].payload.completed_at).toBeTruthy()
    expect(JSON.stringify(events)).not.toContain('operation_id')
  })

  it('marks a failed provider operation on the same canonical lifecycle row', () => {
    const adapter = createAgentWorkSseAdapter(() => Date.parse('2026-09-07T20:00:00.000Z'))
    const start = parseEvents(adapter.transformFrame(frame('provider_step', {
      operation_id: 'custom:fc_1', lifecycle: 'start', label: 'Bilgi bankası sorgusu çalışıyor...', tool: 'Bilgi Bankası', source_type: 'knowledge',
    })))[0]
    const complete = parseEvents(adapter.transformFrame(frame('provider_step', {
      operation_id: 'custom:fc_1', lifecycle: 'complete', failed: true, label: 'Bilgi Bankası işlemi tamamlanamadı', tool: 'Bilgi Bankası', source_type: 'knowledge',
    })))[0]

    expect(complete.payload.event_id).toBe(start.payload.event_id)
    expect(complete.payload.sequence).toBe(start.payload.sequence)
    expect(complete.payload.state).toBe('failed')
  })

  it('persists interaction state only after an unblocked grounded final in the core wiring', () => {
    const core = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
      'utf8',
    )
    expect(core).toContain("activeProvider === 'gemini' && latestGeminiInteractionId && !groundingBlocked")
    expect(core).toContain('createGeminiProviderStateItem(latestGeminiInteractionId)')
    expect(core).toContain('gemini_interaction_state_discarded_grounding')
    expect(core).toContain("sendEvent(controller, encoder, 'provider_step'")
    expect(core).not.toContain("AGENTIC_CONTROLLER_ENABLED\n          ? 'Controller ilk aksiyonu değerlendiriyor...'")
  })
})
