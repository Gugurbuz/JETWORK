import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as mammoth from 'mammoth';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  RefreshCw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MessageAttachment } from '../types';
import { cn } from '../lib/utils';
import { supabase } from '../supabase';
import {
  ASSISTANT_FILES_BUCKET,
  DOCX_MIME,
  PDF_MIME,
  PPTX_MIME,
  XLSX_MIME,
  normalizedAssistantFileMime,
} from '../services/assistantFileRepository';

type SpreadsheetPreview = {
  kind: 'spreadsheet';
  sheets: Array<{
    name: string;
    rows: Array<{ row: number; values: string[] }>;
    maxRow: number;
    maxColumn: number;
  }>;
  truncated?: boolean;
};

type PresentationPreview = {
  kind: 'presentation';
  slides: Array<{
    number: number;
    title: string;
    blocks: Array<{
      text: string;
      left: number;
      top: number;
      width: number;
      height: number;
    }>;
  }>;
  slideWidth?: number;
  slideHeight?: number;
  truncated?: boolean;
};

type PreviewPayload = SpreadsheetPreview | PresentationPreview;

type PreviewState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'image' | 'pdf'; url: string }
  | { kind: 'docx'; html: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'structured'; payload: PreviewPayload }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

interface ArtifactWorkspaceProps {
  artifact: MessageAttachment;
  onClose: () => void;
}

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

const typeLabel = (artifact: MessageAttachment) => {
  const extension = extensionOf(artifact.name);
  return extension ? extension.toUpperCase() : 'FILE';
};

const artifactIcon = (artifact: MessageAttachment, className = 'h-4 w-4') => {
  const mime = normalizedAssistantFileMime(artifact);
  if (mime === XLSX_MIME) return <FileSpreadsheet className={className} />;
  if (mime === PPTX_MIME) return <Presentation className={className} />;
  if (mime.startsWith('image/')) return <FileImage className={className} />;
  if (mime === DOCX_MIME || mime === PDF_MIME || mime.startsWith('text/')) return <FileText className={className} />;
  return <File className={className} />;
};

const signedArtifactUrl = async (artifact: MessageAttachment, download = false): Promise<string> => {
  if (artifact.storageBucket && artifact.storagePath) {
    if (artifact.storageBucket !== ASSISTANT_FILES_BUCKET) throw new Error('Artifact bucket değeri geçersiz.');
    const options = download ? { download: artifact.name || 'jetwork-output' } : undefined;
    const { data, error } = await supabase.storage
      .from(artifact.storageBucket)
      .createSignedUrl(artifact.storagePath, 5 * 60, options);
    if (error || !data?.signedUrl) throw error || new Error('Artifact bağlantısı oluşturulamadı.');
    return data.signedUrl;
  }
  if (artifact.url) return artifact.url;
  throw new Error('Artifact dosya referansı bulunamadı.');
};

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dosya okunamadı (${response.status}).`);
  return response.text();
};

const fetchArrayBuffer = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dosya okunamadı (${response.status}).`);
  return response.arrayBuffer();
};

function SpreadsheetCanvas({ preview }: { preview: SpreadsheetPreview }) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = preview.sheets[sheetIndex];

  useEffect(() => setSheetIndex(0), [preview]);

  if (!sheet) {
    return <div className="flex h-full items-center justify-center text-sm text-theme-text-muted">Çalışma sayfası bulunamadı.</div>;
  }

  const columnCount = Math.max(1, ...sheet.rows.map(row => row.values.length));

  return (
    <div className="flex h-full min-h-0 flex-col bg-theme-bg">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-theme-border bg-theme-surface px-3 py-2">
        {preview.sheets.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            type="button"
            onClick={() => setSheetIndex(index)}
            className={cn(
              'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              index === sheetIndex
                ? 'bg-theme-primary text-theme-primary-fg'
                : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
            )}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white text-slate-900">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="sticky left-0 z-20 w-12 border border-slate-200 bg-slate-100 px-2 py-1.5 text-right font-medium text-slate-500">#</th>
              {Array.from({ length: columnCount }, (_, index) => (
                <th key={index} className="min-w-28 border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-600">
                  {String.fromCharCode(65 + (index % 26))}{index >= 26 ? Math.floor(index / 26) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map(row => (
              <tr key={row.row}>
                <td className="sticky left-0 border border-slate-200 bg-slate-50 px-2 py-1.5 text-right font-medium text-slate-400">{row.row}</td>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex} className="max-w-80 border border-slate-200 px-3 py-1.5 align-top whitespace-pre-wrap">
                    {row.values[columnIndex] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PresentationCanvas({ preview }: { preview: PresentationPreview }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = preview.slides[slideIndex];

  useEffect(() => setSlideIndex(0), [preview]);

  if (!slide) {
    return <div className="flex h-full items-center justify-center text-sm text-theme-text-muted">Slayt bulunamadı.</div>;
  }

  return (
    <div className="flex h-full min-h-0 bg-theme-bg">
      <aside className="hidden w-36 shrink-0 overflow-y-auto border-r border-theme-border bg-theme-surface p-2 md:block">
        <div className="space-y-2">
          {preview.slides.map((item, index) => (
            <button
              key={item.number}
              type="button"
              onClick={() => setSlideIndex(index)}
              className={cn(
                'w-full rounded-lg border p-2 text-left transition-colors',
                index === slideIndex
                  ? 'border-theme-primary bg-theme-primary/5'
                  : 'border-theme-border bg-theme-bg hover:bg-theme-surface-hover',
              )}
            >
              <div className="text-[10px] font-semibold text-theme-text-muted">{item.number}</div>
              <div className="mt-1 line-clamp-3 text-[11px] font-medium text-theme-text">{item.title}</div>
            </button>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-8">
          <article className="aspect-[16/9] w-full max-w-5xl overflow-auto rounded-xl border border-slate-200 bg-white p-8 text-slate-900 shadow-xl sm:p-12">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{slide.title}</h1>
            <div className="space-y-4">
              {slide.blocks.map((block, index) => (
                <div key={index} className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 sm:text-base">
                  {block.text}
                </div>
              ))}
            </div>
          </article>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-theme-border bg-theme-surface px-3 py-2">
          <button
            type="button"
            onClick={() => setSlideIndex(index => Math.max(0, index - 1))}
            disabled={slideIndex === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-30"
            aria-label="Önceki slayt"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-semibold text-theme-text-muted">{slideIndex + 1} / {preview.slides.length}</span>
          <button
            type="button"
            onClick={() => setSlideIndex(index => Math.min(preview.slides.length - 1, index + 1))}
            disabled={slideIndex >= preview.slides.length - 1}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-30"
            aria-label="Sonraki slayt"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArtifactWorkspace({ artifact, onClose }: ArtifactWorkspaceProps) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);
  const mime = useMemo(() => normalizedAssistantFileMime(artifact), [artifact]);
  const extension = extensionOf(artifact.name);

  const loadPreview = useCallback(async () => {
    setPreview({ kind: 'loading' });
    try {
      const url = await signedArtifactUrl(artifact, false);
      if (mime.startsWith('image/')) {
        setPreview({ kind: 'image', url });
        return;
      }
      if (mime === PDF_MIME || extension === 'pdf') {
        setPreview({ kind: 'pdf', url });
        return;
      }
      if (mime === DOCX_MIME || extension === 'docx') {
        const arrayBuffer = await fetchArrayBuffer(url);
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setPreview({ kind: 'docx', html: DOMPurify.sanitize(result.value) });
        return;
      }
      if (mime === XLSX_MIME || mime === PPTX_MIME || extension === 'xlsx' || extension === 'pptx') {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Artifact önizlemesi için oturum bulunamadı.');
        const response = await fetch('/api/artifact-preview', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, name: artifact.name || '', mimeType: mime }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Önizleme oluşturulamadı (${response.status}).`);
        setPreview({ kind: 'structured', payload: payload as PreviewPayload });
        return;
      }
      if (mime === 'text/markdown' || extension === 'md') {
        setPreview({ kind: 'markdown', text: await fetchText(url) });
        return;
      }
      if (
        mime.startsWith('text/')
        || mime === 'application/json'
        || ['txt', 'csv', 'tsv', 'json', 'xml'].includes(extension)
      ) {
        setPreview({ kind: 'text', text: await fetchText(url) });
        return;
      }
      setPreview({ kind: 'unsupported' });
    } catch (error) {
      console.error('Artifact preview failed:', error);
      setPreview({ kind: 'error', message: error instanceof Error ? error.message : 'Artifact önizlenemedi.' });
    }
  }, [artifact, extension, mime]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, reloadToken]);

  const downloadArtifact = async () => {
    try {
      const url = await signedArtifactUrl(artifact, true);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.name || 'jetwork-output';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('Artifact download failed:', error);
      toast.error('Dosya indirme bağlantısı oluşturulamadı.');
    }
  };

  const body = (() => {
    if (preview.kind === 'idle' || preview.kind === 'loading') {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-theme-text-muted">
            <Loader2 size={18} className="animate-spin text-theme-primary" /> Artifact hazırlanıyor...
          </div>
        </div>
      );
    }
    if (preview.kind === 'image') {
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,rgba(148,163,184,0.13),transparent_55%)] p-6">
          <img src={preview.url} alt={artifact.name || 'Artifact'} className="max-h-full max-w-full rounded-lg object-contain shadow-xl" />
        </div>
      );
    }
    if (preview.kind === 'pdf') {
      return <iframe title={artifact.name || 'PDF artifact'} src={preview.url} className="h-full w-full border-0 bg-white" />;
    }
    if (preview.kind === 'docx') {
      return (
        <div className="h-full overflow-auto bg-slate-100 px-4 py-7 sm:px-7 sm:py-10">
          <article className="artifact-docx-page prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-xl sm:px-14 sm:py-14"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      );
    }
    if (preview.kind === 'markdown') {
      return (
        <div className="h-full overflow-auto bg-slate-100 px-4 py-7 sm:px-7 sm:py-10">
          <article className="prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-xl sm:px-14 sm:py-14">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown>
          </article>
        </div>
      );
    }
    if (preview.kind === 'text') {
      return (
        <div className="h-full overflow-auto bg-theme-bg p-4 sm:p-6">
          <pre className="min-h-full whitespace-pre-wrap rounded-xl border border-theme-border bg-theme-surface p-4 text-xs leading-relaxed text-theme-text shadow-sm">{preview.text}</pre>
        </div>
      );
    }
    if (preview.kind === 'structured') {
      return preview.payload.kind === 'spreadsheet'
        ? <SpreadsheetCanvas preview={preview.payload} />
        : <PresentationCanvas preview={preview.payload} />;
    }
    if (preview.kind === 'unsupported') {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-theme-primary/10 text-theme-primary">{artifactIcon(artifact, 'h-6 w-6')}</div>
            <h3 className="font-semibold text-theme-text">Bu format için içerik önizlemesi yok</h3>
            <p className="mt-2 text-sm leading-relaxed text-theme-text-muted">Dosya sağ panelde artifact olarak tutuluyor. İndirme aksiyonuyla orijinal dosyayı açabilirsiniz.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-600"><FileText size={22} /></div>
          <h3 className="font-semibold text-theme-text">Artifact önizlenemedi</h3>
          <p className="mt-2 text-sm leading-relaxed text-theme-text-muted">{preview.message}</p>
          <button
            type="button"
            onClick={() => setReloadToken(value => value + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-xs font-semibold text-theme-text hover:bg-theme-surface-hover"
          >
            <RefreshCw size={14} /> Tekrar dene
          </button>
        </div>
      </div>
    );
  })();

  return (
    <div data-testid="artifact-workspace" className="flex h-full min-h-0 flex-col bg-theme-bg">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-theme-border bg-theme-surface px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
            {artifactIcon(artifact, 'h-[18px] w-[18px]')}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-theme-text">{artifact.name || 'JetWork artifact'}</p>
              <span className="shrink-0 rounded-md border border-theme-border bg-theme-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-theme-text-muted">{typeLabel(artifact)}</span>
            </div>
            <p className="text-[10px] font-medium text-theme-text-muted">Artifact çalışma alanı</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void downloadArtifact()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text"
            title="Orijinal dosyayı indir"
          >
            <Download size={15} /> <span className="hidden sm:inline">İndir</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text"
            title="Artifact panelini kapat"
            aria-label="Artifact panelini kapat"
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
