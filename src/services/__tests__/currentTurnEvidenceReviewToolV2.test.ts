import { describe, expect, it } from 'vitest'
import {
  executeContextTool,
  REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
} from '../../../supabase/functions/_shared/context/contextTools.ts'

const client = {
  rpc: async (name: string) => {
    if (name !== 'get_current_agent_evidence_sources_v2') throw new Error(`unexpected rpc:${name}`)
    return {
      error: null,
      data: [
        {
          tool_name: 'get_abap_source',
          result_summary: { citationReady: true },
          source_refs: [{
            sourceId: 'src-ztks',
            sourceName: 'CHECK_ZTKS source',
            canonicalKey: 'method:check_ztks',
            title: 'CHECK_ZTKS',
          }],
        },
        {
          tool_name: 'gemini_google_search',
          result_summary: { nativeProviderTool: true },
          source_refs: [{
            sourceType: 'web',
            sourceName: 'Official source',
            title: 'Official source',
            url: 'https://example.com/current',
          }],
        },
      ],
    }
  },
}

describe('current-turn evidence review context tool v2', () => {
  it('returns authenticated current-turn evidence IDs before semantic coverage is proposed', async () => {
    const result = await executeContextTool({
      client,
      workspaceId: 'workspace-1',
      toolName: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
      args: { aspects: [] },
    })

    const payload = JSON.parse(result.output)
    expect(payload.evidence).toHaveLength(2)
    expect(payload.evidence.every((item: any) => /^ev_/.test(item.id))).toBe(true)
    expect(payload.critic.controllerDecisionRequired).toBe(true)
    expect(result.summary.citationReady).toBe(false)
  })

  it('accepts only evidence IDs present in the reconstructed running-turn ledger', async () => {
    const inspection = await executeContextTool({
      client,
      workspaceId: 'workspace-1',
      toolName: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
      args: { aspects: [] },
    })
    const inspected = JSON.parse(inspection.output)
    const verifiedId = inspected.evidence[0].id

    const reviewed = await executeContextTool({
      client,
      workspaceId: 'workspace-1',
      toolName: REVIEW_EVIDENCE_COVERAGE_TOOL_NAME,
      args: {
        aspects: [
          { id: 'messages', label: 'Mesajlar', evidenceIds: [verifiedId], status: 'covered' },
          { id: 'conditions', label: 'Koşullar', evidenceIds: ['ev_fabricated'], status: 'covered' },
        ],
      },
    })

    const payload = JSON.parse(reviewed.output)
    expect(payload.aspects.find((item: any) => item.id === 'messages').status).toBe('covered')
    expect(payload.aspects.find((item: any) => item.id === 'conditions').status).toBe('open')
    expect(payload.critic.gaps).toContain('Koşullar')
  })
})
