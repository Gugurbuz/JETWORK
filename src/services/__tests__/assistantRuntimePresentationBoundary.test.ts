import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
const workIndicatorSource = readFileSync(new URL('../../components/AssistantWorkIndicator.tsx', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../messageRepository.ts', import.meta.url), 'utf8');

describe('assistant runtime presentation boundary', () => {
  it('loads the runtime-only presentation boundary globally', () => {
    expect(mainSource).toContain("import './assistant-runtime-ui.css'");
  });

  it('shows bounded operational activities without stage-level timing telemetry', () => {
    expect(workIndicatorSource).toContain('buildAssistantWorkActivities');
    expect(workIndicatorSource).toContain('Nasıl hazırlandı?');
    expect(workIndicatorSource).not.toContain('plannerDuration');
    expect(workIndicatorSource).not.toContain('toolDuration');
    expect(workIndicatorSource).not.toContain('finalModelDuration');
  });

  it('loads the dedicated work-indicator animation globally', () => {
    expect(mainSource).toContain("import './assistant-work-indicator.css'");
    expect(mainSource).not.toContain("import './thinking-legacy.css'");
  });

  it('persists the safe work summary and total duration but keeps provider routing private', () => {
    expect(repositorySource).toContain('thinking_text: message.thinkingText');
    expect(repositorySource).toContain('thinking_time: message.thinkingTime');
    expect(repositorySource).toContain('provider: hidesPrivateRuntimeTelemetry ? null : message.provider');
  });
});
