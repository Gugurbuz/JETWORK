import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const gatewayPath = 'supabase/functions/openai-assistant-v2/index.ts';
const corePath = 'supabase/functions/openai-assistant-core-v2/index.ts';

const gateway = fs.readFileSync(gatewayPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

describe('reasoning stream gateway contract', () => {
  it('keeps the durable reasoning core independent from the downstream request signal', () => {
    expect(gateway).toContain('/functions/v1/openai-assistant-core-v2');
    expect(gateway).not.toMatch(/fetch\([^)]*openai-assistant-core-v2[\s\S]{0,500}signal\s*:/);
    expect(gateway).toContain('EdgeRuntime');
    expect(gateway).toContain('waitUntil');
  });

  it('does not cancel the upstream reader when the downstream stream is cancelled', () => {
    expect(gateway).toContain('cancel(reason)');
    expect(gateway).not.toContain('reader.cancel(');
    expect(gateway).toContain('downstreamCancelled = true');
  });

  it('pins the reasoning core to an immutable verified runtime commit', () => {
    expect(core).toMatch(/raw\.githubusercontent\.com\/Gugurbuz\/JETWORK\/[0-9a-f]{40}\/supabase\/functions\/openai-assistant-v2\/index\.ts/);
  });
});
