import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
const workIndicatorSource = readFileSync(new URL('../../components/AssistantWorkIndicator.tsx', import.meta.url), 'utf8');
const workTimelineSource = readFileSync(new URL('../../components/AgentWorkTimeline.tsx', import.meta.url), 'utf8');
const workIndicatorCss = readFileSync(new URL('../../assistant-work-indicator.css', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../messageRepository.ts', import.meta.url), 'utf8');

describe('assistant runtime presentation boundary', () => {
  it('loads the runtime-only presentation boundary globally', () => {
    expect(mainSource).toContain("import './assistant-runtime-ui.css'");
  });

  it('shows ordered operational activities without stage-level timing telemetry', () => {
    expect(workIndicatorSource).toContain('buildAssistantWorkActivities');
    expect(workIndicatorSource).toContain('<AgentWorkTimeline');
    expect(workTimelineSource).toContain('data-testid={live ? \'assistant-work-live-details\' : \'assistant-work-details\'}');
    expect(workIndicatorSource).not.toContain('plannerDuration');
    expect(workIndicatorSource).not.toContain('toolDuration');
    expect(workIndicatorSource).not.toContain('finalModelDuration');
    expect(workTimelineSource).not.toContain('plannerDuration');
    expect(workTimelineSource).not.toContain('toolDuration');
    expect(workTimelineSource).not.toContain('finalModelDuration');
  });

  it('loads the dedicated work-indicator animation globally', () => {
    expect(mainSource).toContain("import './assistant-work-indicator.css'");
    expect(mainSource).not.toContain("import './thinking-legacy.css'");
  });

  it('keeps desktop and mobile on the same work indicator animation while honoring reduced motion', () => {
    expect(workIndicatorCss).toContain('@keyframes assistant-work-logo-story');
    expect(workIndicatorCss).toContain('animation: assistant-work-logo-story 4.4s cubic-bezier(0.45, 0, 0.2, 1) infinite;');
    expect(workIndicatorCss).not.toContain('assistant-work-orbit-spin');
    expect(workIndicatorCss).not.toContain('.assistant-work__logo-stage::before');
    expect(workIndicatorCss).not.toContain('.assistant-work__logo-stage::after');

    const mobileBlock = workIndicatorCss.slice(
      workIndicatorCss.indexOf('@media (max-width: 640px)'),
      workIndicatorCss.indexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(mobileBlock).not.toContain('assistant-work__logo-motion');

    const reducedMotionBlock = workIndicatorCss.slice(workIndicatorCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotionBlock).toContain('.assistant-work__logo-motion');
    expect(reducedMotionBlock).toContain('.assistant-work__label');
    expect(reducedMotionBlock).toContain('.assistant-work__activity--active .assistant-work__activity-icon');
    expect(reducedMotionBlock).toContain('animation: none;');
  });

  it('persists the safe work summary and total duration but keeps provider routing private', () => {
    expect(repositorySource).toContain('thinking_text: message.thinkingText');
    expect(repositorySource).toContain('thinking_time: message.thinkingTime');
    expect(repositorySource).toContain('provider: hidesPrivateRuntimeTelemetry ? null : message.provider');
  });
});
