import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('Agent Controller V3 explicit source requests', () => {
  it('keeps the complete registered capability surface visible to the model', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.version).toBe('controller-capability-surface-v3-adaptive-work-v1')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('report_progress')
  })

  it('requires an actual source attempt before an absence or access claim', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('belirli ve sana görünür bir kaynak veya tool ailesini açıkça kullanmanı isterse')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ilgili evidence capabilityyi gerçekten denemeden')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('kayıt bulunmadığını')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Gerçek tool observationı boş sonuç')
  })

  it('requires meaningful public work planning without exposing runtime plumbing', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ilk anlamlı evidence/action çağrısından önce report_progress(kind=start)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('çözülmüş hedef + 2-6 maddelik çalışma planının özeti')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=finding)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=plan_change)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Ham function adı, JSON argümanı, provider telemetrysi veya gizli reasoning paylaşma')
  })
})