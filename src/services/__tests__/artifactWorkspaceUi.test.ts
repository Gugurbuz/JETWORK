import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(
  new URL('../../components/WorkspaceView.tsx', import.meta.url),
  'utf8',
);
const fileViewerSource = readFileSync(
  new URL('../../components/FileViewer.tsx', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(
  new URL('../../jetwork-conversation-shell.css', import.meta.url),
  'utf8',
);
const previewWorkerSource = readFileSync(
  new URL('../../../api/artifact-preview.py', import.meta.url),
  'utf8',
);
const assistantRuntimeSource = readFileSync(
  new URL('../assistantRuntimeClient.ts', import.meta.url),
  'utf8',
);

describe('JetWork 2.0 conversation-first file experience', () => {
  it('keeps the conversation primary and opens files in a focused viewer', () => {
    expect(workspaceSource).toContain("import { FileViewer } from './FileViewer'");
    expect(workspaceSource).toContain('<FileViewer file={selectedFile} onClose={closeFile} />');
    expect(workspaceSource).not.toContain("import { ArtifactWorkspace } from './ArtifactWorkspace'");
    expect(workspaceSource).not.toContain('role="separator"');
    expect(workspaceSource).not.toContain('chatPercent');
    expect(workspaceSource).not.toContain('artifact-workspace-open');
    expect(workspaceSource).not.toContain('artifact-workspace-mobile-switch');
    expect(workspaceSource).not.toContain('openArtifact(latestArtifact)');
  });

  it('does not auto-open newly generated files', () => {
    expect(workspaceSource).toContain('const [selectedFile, setSelectedFile]');
    expect(workspaceSource).not.toContain('latestArtifact');
    expect(workspaceSource).not.toContain('UNINITIALIZED_ARTIFACT_KEY');
  });

  it('uses user-facing file language instead of artifact language', () => {
    expect(fileViewerSource).toContain('Dosya açılıyor…');
    expect(fileViewerSource).toContain('Dosya açılamadı');
    expect(fileViewerSource).toContain('Önizlemeyi kapat');
    expect(fileViewerSource).not.toContain('Artifact çalışma alanı');
    expect(fileViewerSource).not.toContain('Artifact hazırlanıyor');
    expect(fileViewerSource).not.toContain('Artifact önizlenemedi');
  });

  it('keeps the calm conversation visual contract', () => {
    expect(shellCss).toContain('[data-message-role="user"]');
    expect(shellCss).toContain('[data-message-role="model"]');
    expect(shellCss).toContain('jetwork-calm-logo');
    expect(shellCss).toContain('prefers-reduced-motion');
  });

  it('keeps legacy BA Canvas interception disabled by default so document requests reach file executors', () => {
    expect(assistantRuntimeSource).toContain("VITE_LEGACY_DOCUMENT_CANVAS ?? 'false'");
    expect(assistantRuntimeSource).toContain("let documentRequestMode: AssistantDocumentRequestMode = 'none'");
    expect(assistantRuntimeSource).toContain('if (legacyDocumentCanvasEnabled)');
  });

  it('previews common file formats without sending private office files to public viewers', () => {
    expect(fileViewerSource).toContain('mammoth.convertToHtml');
    expect(fileViewerSource).toContain("mime === PDF_MIME");
    expect(fileViewerSource).toContain("mime.startsWith('image/')");
    expect(fileViewerSource).toContain("fetch('/api/artifact-preview'");
    expect(fileViewerSource).not.toMatch(/docs\.google\.com|view\.officeapps\.live\.com|office\.com\/viewer/u);
  });

  it('keeps xlsx and pptx structured preview authenticated and scoped to assistant-files', () => {
    expect(previewWorkerSource).toContain('from openpyxl import load_workbook');
    expect(previewWorkerSource).toContain('from pptx import Presentation');
    expect(previewWorkerSource).toContain('/auth/v1/user');
    expect(previewWorkerSource).toContain('/storage/v1/object/sign/assistant-files/');
    expect(previewWorkerSource).toContain('MAX_FILE_BYTES = 20 * 1024 * 1024');
  });
});
