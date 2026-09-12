import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy.ts'
import { buildProviderProductCore } from '../../../supabase/functions/_shared/agent/providerProductCore.ts'
import {
  buildControllerCapabilitySurface,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  gateGeminiAgentToolsForPublicWork,
  PUBLIC_WORK_DIRECT_ANSWER_TOOL,
} from '../../../supabase/functions/_shared/agent/publicWorkProtocol.ts'

describe('Provider cold-start payload budget v1', () => {
  it('keeps the always-on controller constitution small', () => {
    expect(AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION.length).toBeLessThan(2_500)
    expect(AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION).toContain('Semantic karar otoritesi sensin')
    expect(AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION).toContain('just-in-time')
  })

  it('defers heavy product contracts while retaining identity and compact scope', () => {
    const raw = [
      'Sen Enerjisa IT\'de çalışan kıdemli bir İş Analistisin.',
      '',
      'ÇALIŞMA BİÇİMİ',
      'x'.repeat(4_000),
      '[ENERJİSA İHTİYAÇ ANALİZİ DOKÜMAN SÖZLEŞMESİ - ZORUNLU]',
      'y'.repeat(8_000),
      '[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]',
      'z'.repeat(8_000),
      '[CONVERSATION SCOPE]',
      'Mode: PROJECT',
      'Project: Jetwork',
      'Active workspace: Cost optimization',
      '[UNTRUSTED_PROJECT_SIBLING_HUMAN_CONTEXT]',
      'USER: ' + 'sibling '.repeat(2_000),
      '[END_UNTRUSTED_PROJECT_SIBLING_HUMAN_CONTEXT]',
    ].join('\n')

    const compact = buildProviderProductCore(raw)
    expect(compact.length).toBeLessThan(3_000)
    expect(compact).toContain('Sen Enerjisa IT')
    expect(compact).toContain('Project: Jetwork')
    expect(compact).toContain('PROJECT SIBLING HUMAN CONTEXT DEFERRED')
    expect(compact).not.toContain('İHTİYAÇ ANALİZİ DOKÜMAN SÖZLEŞMESİ')
    expect(compact).not.toContain('EXACT TECHNICAL EVIDENCE CONTRACT')
  })

  it('keeps the first-turn physical tool grammar bounded and lazy', () => {
    const surface = buildControllerCapabilitySurface()
    const gated = gateGeminiAgentToolsForPublicWork([], surface.tools, false)
    const firstTurnTools = [
      ...gated.tools,
      PUBLIC_WORK_DIRECT_ANSWER_TOOL,
    ]
    const payload = JSON.stringify(firstTurnTools)

    expect(gated.tools.map(tool => tool.name)).toEqual([
      'report_progress',
      'discover_more_capabilities',
      'execute_capabilities',
    ])
    expect(payload.length).toBeLessThan(6_000)
    expect(payload).not.toContain('create_document_file')
    expect(payload).not.toContain('sync_spreadsheet_with_jira_export')
  })

  it('holds a representative cold-start instruction plus tool envelope under 12k characters', () => {
    const raw = [
      'Sen Enerjisa IT\'de çalışan kıdemli bir İş Analistisin.',
      '',
      'ÇALIŞMA BİÇİMİ',
      'legacy '.repeat(3_000),
      '[CONVERSATION SCOPE]',
      'Mode: STANDALONE',
      'Workspace: Test',
    ].join('\n')
    const productCore = buildProviderProductCore(raw)
    const surface = buildControllerCapabilitySurface()
    const gated = gateGeminiAgentToolsForPublicWork([], surface.tools, false)
    const tools = JSON.stringify([...gated.tools, PUBLIC_WORK_DIRECT_ANSWER_TOOL])
    const publicGateApprox = 1_800

    expect(productCore.length + AGENT_CONTROLLER_PROVIDER_CORE_INSTRUCTION.length + tools.length + publicGateApprox)
      .toBeLessThan(12_000)
  })
})
