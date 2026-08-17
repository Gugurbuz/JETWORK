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
    expect(source).not.toContain("req.signal.addEventListener('abort'");
    expect(source).not.toContain("req.signal.removeEventListener('abort'");
    expect(source).not.toContain('runController.abort(req.signal.reason)');
    expect(source).toContain("const runTimeout = setTimeout(() => runController.abort(new DOMException('Assistant run timed out.'");
    expect(source).toContain('clearTimeout(runTimeout)');
  });

  it('keeps the core entrypoint free of request-abort compatibility shims', () => {
    expect(entrypointSource).not.toContain("req.signal.addEventListener('abort'");
    expect(entrypointSource).not.toContain('abortRun?: () => void');
    expect(entrypointSource).not.toContain('.abortRun = () => {}');
  });

  it('does not execute or display a deterministic knowledge preflight for an adaptive plan with empty evidence queries', () => {
    expect(source).toContain('if (plan.knowledgeRequired && plan.evidenceQueries.length > 0)');
    expect(source).toContain("await collectKnowledge(plan.evidenceQueries, plan, 'preflight')");
  });
});
