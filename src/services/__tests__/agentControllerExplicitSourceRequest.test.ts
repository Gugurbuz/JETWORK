import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('Agent Controller V5 explicit source requests', () => {
  it('keeps every registered logical capability available behind the semantic batch gateway', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.version).toBe('controller-capability-surface-v5.3-semantic-action-batch')
    expect(surface.logicalToolNames).toContain('search_knowledge_catalog')
    expect(surface.logicalToolNames).toContain('get_knowledge_object')
    expect(surface.logicalToolNames).toContain('report_progress')
    expect(surface.toolNames[0]).toBe('report_progress')
    expect(surface.toolNames).toContain('execute_capabilities')
    expect(surface.logicalToolNames).toHaveLength(33)
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