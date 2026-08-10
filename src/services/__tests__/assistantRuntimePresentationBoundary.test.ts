import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
const runtimeCss = readFileSync(new URL('../../assistant-runtime-ui.css', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../messageRepository.ts', import.meta.url), 'utf8');

describe('assistant runtime presentation boundary', () => {
  it('loads the runtime-only presentation boundary globally', () => {
    expect(mainSource).toContain("import './assistant-runtime-ui.css'");
  });

  it('shows only the branded live thinking indicator and hides raw reasoning bodies', () => {
    expect(runtimeCss).toContain("details[class~='group/reasoning']:has(.jetwork-thinking)");
    expect(runtimeCss).toContain("details[class~='group/reasoning']:has(.jetwork-thinking) > div");
    expect(runtimeCss).toContain("details[class~='group/reasoning']:not(:has(.jetwork-thinking))");
    expect(runtimeCss).toContain('display: none');
  });

  it('hides elapsed runtime telemetry from assistant message headers', () => {
    expect(runtimeCss).toContain(".group:has([data-message-role='model'])");
    expect(runtimeCss).toContain('span.text-xs.text-theme-text-muted.ml-2');
  });

  it('never persists single-runtime thinking progress into chat message rows', () => {
    expect(repositorySource).toContain("hidesPrivateRuntimeTelemetry = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && message.role === 'model'");
    expect(repositorySource).toContain('thinking_text: hidesPrivateRuntimeTelemetry ? null : message.thinkingText');
    expect(repositorySource).toContain('thinking_time: hidesPrivateRuntimeTelemetry ? null : message.thinkingTime');
  });
});
