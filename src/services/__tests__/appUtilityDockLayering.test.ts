import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockSource = readFileSync(new URL('../../components/AppUtilityDock.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../../components/Sidebar.tsx', import.meta.url), 'utf8');

describe('sidebar utility dock layering', () => {
  it('removes the utility dock while the profile/settings menu is open', () => {
    expect(sidebarSource).toContain('id="sidebar-ai-model"');
    expect(dockSource).toContain("resolvedFooter?.querySelector('#sidebar-ai-model')");
    expect(dockSource).toContain('portalTarget && !profileMenuOpen ? createPortal(');
  });

  it('restores the utility dock at its normal layer after the profile menu closes', () => {
    expect(dockSource).toContain("'absolute bottom-full z-30 mb-1");
    expect(dockSource).toContain('setProfileMenuOpen(false)');
  });
});
