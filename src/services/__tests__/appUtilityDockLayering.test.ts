import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8');
const mainContentSource = readFileSync(new URL('../../components/MainContent.tsx', import.meta.url), 'utf8');
const fileLibrarySource = readFileSync(new URL('../../components/FileLibrary.tsx', import.meta.url), 'utf8');

describe('sidebar information architecture', () => {
  it('keeps Files and AI Quality Lab inside the native sidebar instead of a sticky footer dock', () => {
    expect(mainContentSource).not.toContain('AppUtilityDock');
    expect(sidebarSource).toContain('Çalışma alanı');
    expect(sidebarSource).toContain('<span>Dosyalar</span>');
    expect(sidebarSource).toContain('<span>AI Quality Lab</span>');
    expect(sidebarSource).toContain("navigate('/quality')");
    expect(sidebarSource).toContain('<FileLibrary onClose={() => setFilesOpen(false)} />');
    expect(fileLibrarySource).toContain('export function FileLibrary');
  });

  it('uses progressive disclosure for long conversation lists', () => {
    expect(sidebarSource).toContain('const STANDALONE_CHAT_PAGE_SIZE = 10');
    expect(sidebarSource).toContain('const PROJECT_CHAT_PAGE_SIZE = 8');
    expect(sidebarSource).toContain('visibleStandalone.slice(0, visibleStandaloneCount)');
    expect(sidebarSource).toContain('visibleWorkspaces.slice(0, projectChatLimit)');
    expect(sidebarSource).toContain('Daha fazla göster');
    expect(sidebarSource).toContain('Math.max(previous[activeProject.id] || PROJECT_CHAT_PAGE_SIZE, activeIndex + 1)');
  });
});
