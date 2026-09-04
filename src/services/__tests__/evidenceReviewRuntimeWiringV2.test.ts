import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import { isContextTool } from '../../../supabase/functions/_shared/context/contextTools.ts'

describe('evidence review runtime wiring v2', () => {
  it('keeps evidence review always visible without making it a ranked semantic candidate', () => {
    const surface = buildControllerCapabilitySurface([])
    expect(surface.toolNames).toContain(REVIEW_EVIDENCE_COVERAGE_TOOL_NAME)
    expect(surface.candidateIds).toEqual([])
    expect(isContextTool(REVIEW_EVIDENCE_COVERAGE_TOOL_NAME)).toBe(true)
  })

  it('routes the meta capability through the normal assistant context executor', () => {
    const assistantTools = readFileSync(
      new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
      'utf8',
    )
    const contextTools = readFileSync(
      new URL('../../../supabase/functions/_shared/context/contextTools.ts', import.meta.url),
      'utf8',
    )

    expect(assistantTools).toContain('if (isContextTool(toolName)) return executeContextTool')
    expect(contextTools).toContain("input.toolName === REVIEW_EVIDENCE_COVERAGE_TOOL_NAME")
    expect(contextTools).toContain("get_current_agent_evidence_sources_v2")
    expect(contextTools).toContain('createEvidenceControllerSession')
  })

  it('does not give the critic routing or tool-execution authority', () => {
    const critic = readFileSync(
      new URL('../../../supabase/functions/_shared/evidence/critic.ts', import.meta.url),
      'utf8',
    )
    expect(critic).toContain('controllerDecisionRequired: true')
    expect(critic).not.toContain('executeAssistantTool(')
    expect(critic).not.toContain('executeSkillTool(')
    expect(critic).not.toContain('selectedCapability')
  })
})
