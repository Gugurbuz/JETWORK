import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../../components/WorkspaceView.tsx', import.meta.url),
  'utf8',
);
const artifactSource = readFileSync(
  new URL('../../components/ArtifactWorkspace.tsx', import.meta.url),
  'utf8',
);
const previewWorkerSource = readFileSync(
  new URL('../../../api/artifact-preview.py', import.meta.url),
  'utf8',
);

describe('ChatGPT-like artifact workspace', () => {
  it('uses one generic right-side artifact workspace instead of the legacy BA tabs', () => {
    expect(workspaceSource).toContain("import { ArtifactWorkspace } from './ArtifactWorkspace'");
    expect(workspaceSource).toContain('data-testid="artifact-workspace-shell"');
    expect(workspaceSource).toContain('<ArtifactWorkspace artifact={selectedArtifact} onClose={closeArtifact} />');
    expect(workspaceSource).not.toContain("import { DocumentPanel } from './DocumentPanel'");
    expect(workspaceSource).not.toContain('BA Analiz Çalışma Alanı');
    expect(workspaceSource).not.toContain('BA Analizi');
    expect(workspaceSource).not.toContain("type MobileSurface = 'chat' | 'document'");
  });

  it('treats generated tool outputs as selectable artifacts and auto-opens new output', () => {
    expect(workspaceSource).toContain("attachment.purpose === 'tool_output'");
    expect(workspaceSource).toContain('openArtifact(latestArtifact)');
    expect(workspaceSource).toContain('MutationObserver');
    expect(workspaceSource).toContain('önizlemesini sağda aç');
    expect(workspaceSource).toContain('role="separator"');
  });

  it('previews common artifact formats without sending private office files to public viewers', () => {
    expect(artifactSource).toContain('mammoth.convertToHtml');
    expect(artifactSource).toContain("mime === PDF_MIME");
    expect(artifactSource).toContain("mime.startsWith('image/')");
    expect(artifactSource).toContain("fetch('/api/artifact-preview'");
    expect(artifactSource).toContain('<SpreadsheetCanvas preview={preview.payload} />');
    expect(artifactSource).toContain('<PresentationCanvas preview={preview.payload} />');
    expect(artifactSource).not.toMatch(/docs\.google\.com|view\.officeapps\.live\.com|office\.com\/viewer/u);
  });

  it('keeps xlsx and pptx structured preview authenticated and scoped to assistant-files', () => {
    expect(previewWorkerSource).toContain('from openpyxl import load_workbook');
    expect(previewWorkerSource).toContain('from pptx import Presentation');
    expect(previewWorkerSource).toContain('/auth/v1/user');
    expect(previewWorkerSource).toContain('/storage/v1/object/sign/assistant-files/');
    expect(previewWorkerSource).toContain('MAX_FILE_BYTES = 20 * 1024 * 1024');
  });
});
