import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceSource = readFileSync(new URL('../../components/WorkspaceView.tsx', import.meta.url), 'utf8');
const mainContentSource = readFileSync(new URL('../../components/MainContent.tsx', import.meta.url), 'utf8');
const fileViewerSource = readFileSync(new URL('../../components/FileViewer.tsx', import.meta.url), 'utf8');
const fileViewerLoadingCss = readFileSync(new URL('../../components/file-viewer-loading.css', import.meta.url), 'utf8');
const fileLibrarySource = readFileSync(new URL('../../components/FileLibrary.tsx', import.meta.url), 'utf8');
const modelControlSource = readFileSync(new URL('../../components/CompactModelControl.tsx', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../../jetwork-conversation-shell.css', import.meta.url), 'utf8');
const filePanelCss = readFileSync(new URL('../../workspace-file-panel.css', import.meta.url), 'utf8');
const previewWorkerSource = readFileSync(new URL('../../../api/artifact-preview.py', import.meta.url), 'utf8');
const assistantRuntimeSource = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8');

describe('JetWork 2.0 conversation + file experience', () => {
  it('keeps generated files inline and pins the selected file to a temporary right-side workspace', () => {
    expect(workspaceSource).toContain("import { FileViewer } from './FileViewer'");
    expect(workspaceSource).toContain('data-testid="workspace-right-file-panel"');
    expect(workspaceSource).toContain('workspace-side-file-viewer');
    expect(workspaceSource).toContain('dosyasını sağda aç');
    expect(workspaceSource).toContain('<FileViewer file={selectedFile} onClose={closeFile} />');
    expect(filePanelCss).toContain('clamp(320px, 34%, 560px)');
    expect(filePanelCss).toContain('flex-direction: row !important');
    expect(filePanelCss).toContain('position: absolute;');
    expect(filePanelCss).toContain('left: clamp(320px, 34%, 560px)');
    expect(filePanelCss).toContain('.workspace-side-file-viewer > [role="dialog"]');
    expect(workspaceSource).not.toContain("import { ArtifactWorkspace } from './ArtifactWorkspace'");
    expect(workspaceSource).not.toContain('role="separator"');
    expect(workspaceSource).not.toContain('chatPercent');
    expect(workspaceSource).not.toContain('artifact-workspace-open');
    expect(workspaceSource).not.toContain('artifact-workspace-mobile-switch');
  });

  it('does not auto-open newly generated files and leaves the file card under the response', () => {
    expect(workspaceSource).toContain('const [selectedFile, setSelectedFile]');
    expect(workspaceSource).toContain('Compatibility bridge for the current ChatPanel output card');
    expect(workspaceSource).not.toContain('latestArtifact');
    expect(workspaceSource).not.toContain('UNINITIALIZED_ARTIFACT_KEY');
    expect(workspaceSource).not.toContain('openArtifact(latestArtifact)');
  });

  it('restores the original sidebar surface while keeping the separate Dosyalar entry', () => {
    expect(mainContentSource).toContain('<AppUtilityDock />');
    expect(mainContentSource).not.toContain('SidebarSurfaceEnhancer');
  });

  it('uses user-facing file language instead of artifact language', () => {
    expect(fileViewerSource).toContain('Dosya açılıyor…');
    expect(fileViewerSource).toContain('Dosya açılamadı');
    expect(fileViewerSource).toContain('Önizlemeyi kapat');
    expect(fileViewerSource).not.toContain('Artifact çalışma alanı');
    expect(fileViewerSource).not.toContain('Artifact hazırlanıyor');
    expect(fileViewerSource).not.toContain('Artifact önizlenemedi');
  });

  it('uses a loading-specific JetWork heartbeat for file opening instead of a generic spinner', () => {
    expect(fileViewerSource).toContain("import { JetWorkLogo } from './JetWorkLogo'");
    expect(fileViewerSource).toContain('jetwork-file-loader-mark');
    expect(fileViewerSource).toContain('jetwork-file-loader-pulse--primary');
    expect(fileViewerSource).toContain('jetwork-file-loader-logo-motion');
    expect(fileViewerSource).not.toContain('Loader2');
    expect(fileViewerLoadingCss).toContain('@keyframes jetwork-file-logo-heartbeat');
    expect(fileViewerLoadingCss).toContain('@keyframes jetwork-file-heartbeat-ring');
    expect(fileViewerLoadingCss).toContain('@keyframes jetwork-file-text-shimmer');
    expect(fileViewerLoadingCss).not.toContain('jetwork-file-logo-breathe');
    expect(fileViewerLoadingCss).not.toContain('jetwork-file-ring-turn');
    expect(fileViewerLoadingCss).not.toContain('assistant-work-logo-story');
    expect(fileViewerLoadingCss).toContain('prefers-reduced-motion');
  });

  it('keeps DOCX fallback clean without a technical preview disclaimer', () => {
    expect(fileViewerSource).toContain('preferredDocxRendition');
    expect(fileViewerSource).toContain('previewStoragePath');
    expect(fileViewerSource).not.toContain('Hızlı içerik önizlemesi');
    expect(fileViewerSource).not.toContain('Word’deki sayfa yerleşimi');
  });

  it('keeps the conversation visual contract without overriding the shared thinking animation', () => {
    expect(shellCss).toContain('[data-message-role="user"]');
    expect(shellCss).toContain('[data-message-role="model"]');
    expect(shellCss).not.toContain('jetwork-calm-logo');
    expect(shellCss).not.toContain('.assistant-work__logo-motion');
    expect(shellCss).toContain('prefers-reduced-motion');
    expect(shellCss).not.toContain('animation-duration: .001ms !important');
    expect(shellCss).not.toContain('animation-iteration-count: 1 !important');
    expect(workspaceSource).toContain('<CompactModelControl');
    expect(modelControlSource).toContain("{ value: 'auto', label: 'Otomatik'");
  });

  it('keeps the welcome background logos moving independently from CSS motion preferences', () => {
    expect(mainContentSource).toContain('data-testid="floating-jetwork-logo"');
    expect(mainContentSource).toContain('requestAnimationFrame(tick)');
    expect(mainContentSource).toContain('cancelAnimationFrame(frameId)');
    expect(mainContentSource).toContain('element.style.transform = `translate3d(');
  });

  it('provides a global Dosyalar library over generated tool outputs', () => {
    expect(fileLibrarySource).toContain(".from('messages')");
    expect(fileLibrarySource).toContain("file.purpose !== 'tool_output'");
    expect(fileLibrarySource).toContain('Dosyalarda ara');
    expect(fileLibrarySource).toContain('Belgeler');
    expect(fileLibrarySource).toContain('Sunumlar');
  });

  it('keeps viewer keyboard behavior accessible', () => {
    expect(fileViewerSource).toContain("event.key === 'Escape'");
    expect(fileViewerSource).toContain("event.key !== 'Tab'");
    expect(fileViewerSource).toContain('aria-modal="true"');
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