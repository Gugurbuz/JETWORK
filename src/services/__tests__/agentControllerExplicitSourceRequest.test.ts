import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('Agent Controller V3 explicit source requests', () => {
  it('keeps the complete registered capability surface visible to the model', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.version).toBe('controller-capability-surface-v3-full')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('report_progress')
    expect(surface.discoveryMode).toBeUndefined()
  })

  it('requires an actual source attempt before an absence or access claim', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('belirli ve sana görünür bir kaynak veya tool ailesini açıkça kullanmanı isterse')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ilgili capabilityyi gerçekten denemeden')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('kayıt bulunmadığını')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Gerçek tool observationı boş sonuç')
  })

  it('requires meaningful public progress without exposing runtime plumbing', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ilk anlamlı çalışmaya başlamadan önce report_progress')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Bilgi bankasında ilgili kayıtları inceliyorum...')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ham function adı, JSON argümanı, provider telemetrysi veya gizli reasoning paylaşma')
  })
})
