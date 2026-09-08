import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const workspaceV2Source = readFileSync(new URL('../../components/WorkspaceViewV2.tsx', import.meta.url), 'utf8');
const generatedCardSource = readFileSync(new URL('../../components/artifacts/GeneratedFileCard.tsx', import.meta.url), 'utf8');
const fileCardCss = readFileSync(new URL('../../generated-file-cards.css', import.meta.url), 'utf8');

describe('active document card UX regression guard', () => {
  it('locks the active WorkspaceViewV2 path to the typed inline file-card behavior', () => {
    expect(appSource).toContain("import { WorkspaceView } from './components/WorkspaceViewV2'");
    expect(workspaceV2Source).toContain("import { fileVisualMeta } from '../lib/files/fileMeta'");
    expect(workspaceV2Source).toContain('jetwork-generated-file-card');
    expect(workspaceV2Source).toContain('data-jetwork-file-name');
    expect(workspaceV2Source).toContain('data-jetwork-file-kind');
    expect(workspaceV2Source).toContain('dosyasını sağda aç');
    expect(workspaceV2Source).toContain("typeLabel.textContent = visual.label");
    expect(workspaceV2Source).toContain('openFile(file)');
  });

  it('renders recognizable file icons instead of raw W/X/P/PDF text marks', () => {
    expect(generatedCardSource).toContain('FileSpreadsheet');
    expect(generatedCardSource).toContain('Presentation');
    expect(generatedCardSource).toContain('Image as ImageIcon');
    expect(generatedCardSource).toContain('fileTypeIcon(visual.kind)');
    expect(generatedCardSource).not.toContain('{visual.mark}');
    expect(fileCardCss).toContain('background-image: url("data:image/svg+xml');
    expect(fileCardCss).not.toContain('content: "W"');
    expect(fileCardCss).not.toContain('content: "X"');
    expect(fileCardCss).not.toContain('content: "P"');
    expect(fileCardCss).not.toContain('content: "PDF"');
  });
});
