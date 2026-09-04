import { describe, expect, it } from 'vitest'
import { readAgenticRuntimeDebugTelemetry } from '../agenticRuntimeDebugReader'

describe('agentic runtime debug reader', () => {
  it('maps one staging message to mechanical controller telemetry without judge assertions', async () => {
    const client = {
      rpc: async (name: string) => {
        if (name === 'get_reasoning_debug_runs') {
          return {
            error: null,
            data: [
              { run_id: 'run-old', message_id: 'other' },
              { run_id: 'run-1', message_id: 'msg-1' },
            ],
          }
        }
        if (name === 'get_reasoning_debug_run') {
          return {
            error: null,
            data: {
              status: 'completed',
              latencyMs: 6_200,
              toolCallCount: 2,
              responseModel: 'gpt-5.6-sol',
              provider: 'openai',
              usage: { input_tokens: 1_000, output_tokens: 250, estimated_total_cost_usd: 0.03 },
              evidenceSummary: { knowledgeSources: 2, webSources: 0 },
              toolRuns: [
                {
                  toolName: 'get_abap_source',
                  status: 'completed',
                  resultSummary: { selectedByController: true, citationReady: true },
                },
                {
                  toolName: 'review_evidence_coverage',
                  status: 'completed',
                  resultSummary: { selectedByController: true, evidenceReview: true },
                },
              ],
            },
          }
        }
        throw new Error(`unexpected rpc:${name}`)
      },
    }

    const result = await readAgenticRuntimeDebugTelemetry({
      client,
      workspaceId: 'ws-1',
      messageId: 'msg-1',
    })

    expect(result.runId).toBe('run-1')
    expect(result.latencyMs).toBe(6_200)
    expect(result.toolCallCount).toBe(2)
    expect(result.usage.estimated_total_cost_usd).toBe(0.03)
    expect(result.telemetry.completed).toBe(true)
    expect(result.telemetry.judgeAssertions).toEqual([])
    expect(result.telemetry.observedBehaviors).toEqual([])
    expect(result.telemetry.toolRuns).toEqual([
      expect.objectContaining({ toolName: 'get_abap_source', selectedByController: true }),
      expect.objectContaining({ toolName: 'review_evidence_coverage', selectedByController: true }),
    ])
  })

  it('fails when the requested staging message has no reasoning run instead of selecting a nearby run', async () => {
    const client = {
      rpc: async () => ({ error: null, data: [{ run_id: 'run-other', message_id: 'other' }] }),
    }

    await expect(readAgenticRuntimeDebugTelemetry({
      client,
      workspaceId: 'ws-1',
      messageId: 'missing',
    })).rejects.toThrow('AGENTIC_DEBUG_RUN_NOT_FOUND:missing')
  })
})
