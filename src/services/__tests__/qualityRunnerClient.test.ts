import { describe, expect, it, vi } from 'vitest';
import { qualityRunnerInternals, runQualitySuite } from '../qualityRunnerClient';

describe('qualityRunnerClient', () => {
  it('surfaces the Edge Function HTTP status and response body', async () => {
    const error = {
      message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ error: 'Assistant HTTP 504' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      }),
    };

    await expect(qualityRunnerInternals.functionErrorMessage(error))
      .resolves.toBe('HTTP 504 · Assistant HTTP 504');
  });

  it('executes every scenario in a separate function invocation', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { run: { id: 'run-1' }, scenarioIds: ['case-1', 'case-2'] }, error: null })
      .mockResolvedValueOnce({ data: { run: { id: 'run-1', status: 'running' } }, error: null })
      .mockResolvedValueOnce({ data: { run: { id: 'run-1', status: 'completed', passed_cases: 2 } }, error: null });
    const progress = vi.fn();

    const result = await runQualitySuite({ functions: { invoke } } as any, { suiteSlug: 'smoke' }, progress);

    expect(result.run.status).toBe('completed');
    expect(invoke.mock.calls.map(call => call[1].body.operation)).toEqual(['prepare', 'execute', 'execute']);
    expect(invoke.mock.calls[1][1].body).toMatchObject({ runId: 'run-1', scenarioId: 'case-1' });
    expect(invoke.mock.calls[2][1].body).toMatchObject({ runId: 'run-1', scenarioId: 'case-2' });
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, scenarioId: 'case-2' });
  });

  it('marks the aggregate run failed when a case invocation returns non-2xx', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { run: { id: 'run-1' }, scenarioIds: ['case-1'] }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { context: new Response(JSON.stringify({ error: 'timeout' }), { status: 504 }) },
      })
      .mockResolvedValueOnce({ data: { run: { id: 'run-1', status: 'failed' } }, error: null });

    await expect(runQualitySuite({ functions: { invoke } } as any, { suiteSlug: 'smoke' }))
      .rejects.toThrow('HTTP 504 · timeout');
    expect(invoke.mock.calls[2][1].body).toMatchObject({ operation: 'fail', runId: 'run-1' });
  });
});
