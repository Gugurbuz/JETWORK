import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('Agent Controller V4 explicit source requests', () => {
  it('keeps the complete registered capability surface available after lifecycle start', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.version).toBe('controller-capability-surface-v4-public-work-plan')
    expect(surface.toolNames).toContain('search_knowledge_catalog')
    expect(surface.toolNames).toContain('get_knowledge_object')
    expect(surface.toolNames).toContain('report_progress')
    expect(surface.toolNames[0]).toBe('report_progress')
  })

  it('requires an actual source attempt before an absence or access claim', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('belirli ve sana görünür bir kaynak veya tool ailesini açıkça kullanmanı isterse')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('ilgili evidence capabilityyi gerçekten denemeden')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('kayıt bulunmadığını')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Gerçek tool observationı boş sonuç')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('İlk ranked candidate araması boş dönerse')
  })

  it('requires meaningful public work planning without exposing runtime plumbing', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=start)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('`resolvedGoal` alanına')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('`planSteps` alanına 2-6 maddelik gerçek çalışma planını')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('`evidenceGaps` alanına')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=finding)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=plan_change)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Ham function adı, JSON, capability sayısı, provider telemetrysi')
  })
})