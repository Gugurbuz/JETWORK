import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Reasoning Engine durable core transport lifecycle', () => {
  const source = readFileSync(
    new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
    'utf8',
  );
  const entrypointSource = readFileSync(
    new URL('../../../supabase/functions/openai-assistant-core-v2/index.ts', import.meta.url),
    'utf8',
  );

  it('does not bind a durably claimed reasoning run to the incoming HTTP request signal', () => {
    expect(source).toContain('transport disconnects must not cancel the');
    expect(source).toContain('RUN_TIMEOUT_MS remains the lifecycle guard');
    expect(source).not.toContain("req.signal.addEventListener('abort', abortRun");
    expect(source).not.toContain("runController.abort(req.signal.reason)");
    expect(source).toContain("runController.abort(new DOMException('Assistant run timed out.'");
  });

  it('keeps the legacy stream-finalizer listener cleanup reference safe without reattaching request aborts', () => {
    expect(source).toContain("req.signal.removeEventListener('abort', abortRun)");
    expect(entrypointSource).toContain("globalThis & { abortRun?: () => void }");
    expect(entrypointSource).toContain('.abortRun = () => {}');
    expect(entrypointSource).not.toContain("req.signal.addEventListener('abort'");
  });

  it('does not execute or display a deterministic knowledge preflight for an adaptive plan with empty evidence queries', () => {
    expect(source).toContain('if (plan.knowledgeRequired && plan.evidenceQueries.length > 0)');
    expect(source).toContain("await collectKnowledge(plan.evidenceQueries, plan, 'preflight')");
  });
});
