import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatPanelSource = readFileSync(new URL('../../components/ChatPanel.tsx', import.meta.url), 'utf8');
const timelineSource = readFileSync(new URL('../../components/AgentWorkTimeline.tsx', import.meta.url), 'utf8');
const controllerSurfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
);

describe('quality-first visibility contract', () => {
  it('shows every grounded knowledge source instead of truncating to the first three', () => {
    expect(chatPanelSource).toContain('{sourceView.knowledgeSources.length} kurumsal kaynak kullanıldı');
    expect(chatPanelSource).toContain('sourceView.knowledgeSources.map((source, index) =>');
    expect(chatPanelSource).not.toContain('Math.min(sourceView.knowledgeSources.length, 3)');
    expect(chatPanelSource).not.toContain('sourceView.knowledgeSources.slice(0, 3)');
  });

  it('renders the complete canonical Agent Work timeline without presentation compaction', () => {
    expect(timelineSource).toContain('ordered.map(renderEvent)');
    expect(timelineSource).not.toContain('splitAgentWorkTimeline');
    expect(timelineSource).not.toContain('compactAfter');
    expect(timelineSource).not.toContain('işlem daha');
  });

  it('does not cap report_progress source references for presentation reasons', () => {
    const sourceRefsLine = controllerSurfaceSource
      .split(/\r?\n/u)
      .find(line => line.includes('sourceRefs:')) || '';
    expect(sourceRefsLine).toContain("type: ['array', 'null']");
    expect(sourceRefsLine).not.toContain('maxItems');
  });
});
