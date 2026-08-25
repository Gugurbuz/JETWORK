import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    blocks: Array<{ text: string; left: number; top: number; width: number; height: number }>;
  }>;
  slideWidth?: number;
  slideHeight?: number;
  truncated?: boolean;
};

type PreviewPayload = SpreadsheetPreview | PresentationPreview;
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; url: string }
  | { kind: 'docx'; html: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'structured'; payload: PreviewPayload }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

interface FileViewerProps {
  file: MessageAttachment;
  onClose: () => void;
}

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

const fileTypeLabel = (file: MessageAttachment) => {
  const extension = extensionOf(file.name);
  if (extension === 'docx') return 'Word belgesi';
  if (extension === 'xlsx') return 'Excel çalışma kitabı';
  if (extension === 'pptx') return 'PowerPoint sunumu';
  if (extension === 'pdf') return 'PDF';
  if (normalizedAssistantFileMime(file).startsWith('image/')) return 'Görsel';
  if (extension === 'md') return 'Markdown belgesi';
  if (extension === 'txt') return 'Metin belgesi';
  return extension ? `${extension.toLocaleUpperCase('tr-TR')} dosyası` : 'Dosya';
};

const fileIcon = (file: MessageAttachment, className = 'h-4 w-4') => {
  const mime = normalizedAssistantFileMime(file);
  if (mime === XLSX_MIME) return <FileSpreadsheet className={className} />;
  if (mime === PPTX_MIME) return <Presentation className={className} />;
  if (mime.startsWith('image/')) return <FileImage className={className} />;
  if (mime === DOCX_MIME || mime === PDF_MIME || mime.startsWith('text/')) return <FileText className={className} />;
  return <File className={className} />;
};

const signedFileUrl = async (file: MessageAttachment, download = false): Promise<string> => {
  if (file.storageBucket && file.storagePath) {
    if (file.storageBucket !== ASSISTANT_FILES_BUCKET) throw new Error('Dosya konumu doğrulanamadı.');
    const { data, error } = await supabase.storage.from(file.storageBucket).createSignedUrl(
      file.storagePath,
      5 * 60,
      download ? { download: file.name || 'jetwork-output' } : undefined,
    );
    if (error || !data?.signedUrl) throw error || new Error('Dosya bağlantısı oluşturulamadı.');
    return data.signedUrl;
  }
  if (file.url) return file.url;
  throw new Error('Dosya referansı bulunamadı.');
};

const fetchChecked = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dosya okunamadı (${response.status}).`);
  return response;
};

const columnLabel = (index: number) => {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};

function SpreadsheetPreviewView({ preview }: { preview: SpreadsheetPreview }) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = preview.sheets[sheetIndex];
  useEffect(() => setSheetIndex(0), [preview]);
  if (!sheet) return <div className="flex h-full items-center justify-center text-sm text-theme-text-muted">Çalışma sayfası bulunamadı.</div>;
  const columnCount = Math.max(1, ...sheet.rows.map(row => row.values.length));

  return (
    <div className="flex h-full min-h-0 flex-col bg-theme-bg">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-theme-border/70 bg-theme-surface/90 px-3 py-2">
        {preview.sheets.map((item, index) => (
          <button key={`${item.name}-${index}`} type="button" onClick={() => setSheetIndex(index)} className={cn(
            'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            index === sheetIndex ? 'bg-theme-text text-theme-bg' : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text',
          )}>{item.name}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white text-slate-900">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100"><tr>
            <th className="sticky left-0 z-20 w-12 border border-slate-200 bg-slate-100 px-2 py-1.5 text-right font-medium text-slate-500">#</th>
            {Array.from({ length: columnCount }, (_, index) => <th key={index} className="min-w-28 border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-600">{columnLabel(index)}</th>)}
          </tr></thead>
          <tbody>{sheet.rows.map(row => <tr key={row.row}>
            <td className="sticky left-0 border border-slate-200 bg-slate-50 px-2 py-1.5 text-right font-medium text-slate-400">{row.row}</td>
            {Array.from({ length: columnCount }, (_, columnIndex) => <td key={columnIndex} className="max-w-80 border border-slate-200 px-3 py-1.5 align-top whitespace-pre-wrap">{row.values[columnIndex] || ''}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function PresentationPreviewView({ preview }: { preview: PresentationPreview }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = preview.slides[slideIndex];
  useEffect(() => setSlideIndex(0), [preview]);
  if (!slide) return <div className="flex h-full items-center justify-center text-sm text-theme-text-muted">Slayt bulunamadı.</div>;

  return (
    <div className="flex h-full min-h-0 bg-theme-bg">
      <aside className="hidden w-36 shrink-0 overflow-y-auto border-r border-theme-border/70 bg-theme-surface/70 p-2 md:block">
        <div className="space-y-2">{preview.slides.map((item, index) => (
          <button key={item.number} type="button" onClick={() => setSlideIndex(index)} className={cn(
            'w-full rounded-xl border p-2 text-left transition-colors',
            index === slideIndex ? 'border-theme-text/20 bg-theme-bg' : 'border-theme-border/70 bg-theme-bg/60 hover:bg-theme-surface-hover',
          )}>
            <div className="text-[10px] font-semibold text-theme-text-muted">{item.number}</div>
            <div className="mt-1 line-clamp-3 text-[11px] font-medium text-theme-text">{item.title}</div>
          </button>
        ))}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-8">
          <article className="aspect-[16/9] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-8 text-slate-900 shadow-lg sm:p-12">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{slide.title}</h1>
            <div className="space-y-4">{slide.blocks.map((block, index) => <div key={index} className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 sm:text-base">{block.text}</div>)}</div>
          </article>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-theme-border/70 bg-theme-surface/80 px-3 py-2">
          <button type="button" onClick={() => setSlideIndex(index => Math.max(0, index - 1))} disabled={slideIndex === 0} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-30" aria-label="Önceki slayt"><ChevronLeft size={16} /></button>
          <span className="text-xs font-semibold text-theme-text-muted">{slideIndex + 1} / {preview.slides.length}</span>
          <button type="button" onClick={() => setSlideIndex(index => Math.min(preview.slides.length - 1, index + 1))} disabled={slideIndex >= preview.slides.length - 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-theme-text-muted hover:bg-theme-surface-hover disabled:opacity-30" aria-label="Sonraki slayt"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

export function FileViewer({ file, onClose }: FileViewerProps) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mime = useMemo(() => normalizedAssistantFileMime(file), [file]);
  const extension = extensionOf(file.name);

  const loadPreview = useCallback(async () => {
    setPreview({ kind: 'loading' });
    try {
      const url = await signedFileUrl(file);
      if (mime.startsWith('image/')) return setPreview({ kind: 'image', url });
      if (mime === PDF_MIME || extension === 'pdf') return setPreview({ kind: 'pdf', url });
      if (mime === DOCX_MIME || extension === 'docx') {
        const result = await mammoth.convertToHtml({ arrayBuffer: await (await fetchChecked(url)).arrayBuffer() });
        return setPreview({ kind: 'docx', html: DOMPurify.sanitize(result.value) });
      }
      if (mime === XLSX_MIME || mime === PPTX_MIME || extension === 'xlsx' || extension === 'pptx') {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Önizleme için oturum bulunamadı.');
        const response = await fetch('/api/artifact-preview', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: file.name || '', mimeType: mime }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Önizleme oluşturulamadı (${response.status}).`);
        return setPreview({ kind: 'structured', payload: payload as PreviewPayload });
      }
      if (mime === 'text/markdown' || extension === 'md') return setPreview({ kind: 'markdown', text: await (await fetchChecked(url)).text() });
      if (mime.startsWith('text/') || mime === 'application/json' || ['txt', 'csv', 'tsv', 'json', 'xml'].includes(extension)) return setPreview({ kind: 'text', text: await (await fetchChecked(url)).text() });
      setPreview({ kind: 'unsupported' });
    } catch (error) {
      console.error('File preview failed:', error);
      setPreview({ kind: 'error', message: error instanceof Error ? error.message : 'Dosya açılamadı.' });
    }
  }, [extension, file, mime]);

  useEffect(() => { void loadPreview(); }, [loadPreview, reloadToken]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const downloadFile = async () => {
    try {
      const url = await signedFileUrl(file, true);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name || 'jetwork-output';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('File download failed:', error);
      toast.error('Dosya indirme bağlantısı oluşturulamadı.');
    }
  };

  const renderPreview = () => {
    switch (preview.kind) {
      case 'idle':
      case 'loading':
        return <div className="flex h-full items-center justify-center"><div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={17} className="animate-spin" /> Dosya açılıyor…</div></div>;
      case 'image':
        return <div className="flex h-full items-center justify-center overflow-auto bg-slate-100/70 p-6"><img src={preview.url} alt={file.name || 'Dosya'} className="max-h-full max-w-full rounded-xl object-contain shadow-lg" /></div>;
      case 'pdf':
        return <iframe title={file.name || 'PDF'} src={preview.url} className="h-full w-full border-0 bg-white" />;
      case 'docx':
        return <div className="h-full overflow-auto bg-slate-100 px-4 py-7 sm:px-7 sm:py-10"><article className="artifact-docx-page prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-lg sm:px-14 sm:py-14" dangerouslySetInnerHTML={{ __html: preview.html }} /></div>;
      case 'markdown':
        return <div className="h-full overflow-auto bg-slate-100 px-4 py-7 sm:px-7 sm:py-10"><article className="prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-lg sm:px-14 sm:py-14"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown></article></div>;
      case 'text':
        return <div className="h-full overflow-auto bg-theme-bg p-4 sm:p-6"><pre className="min-h-full whitespace-pre-wrap rounded-2xl border border-theme-border/70 bg-theme-surface p-4 text-xs leading-relaxed text-theme-text">{preview.text}</pre></div>;
      case 'structured':
        return preview.payload.kind === 'spreadsheet' ? <SpreadsheetPreviewView preview={preview.payload} /> : <PresentationPreviewView preview={preview.payload} />;
      case 'unsupported':
        return <div className="flex h-full items-center justify-center p-8 text-center"><div className="max-w-sm"><div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-theme-surface text-theme-text">{fileIcon(file, 'h-5 w-5')}</div><h3 className="font-semibold text-theme-text">Bu dosya burada önizlenemiyor</h3><p className="mt-2 text-sm leading-relaxed text-theme-text-muted">Orijinal dosyayı indirerek açabilirsiniz.</p></div></div>;
      case 'error':
        return <div className="flex h-full items-center justify-center p-8 text-center"><div className="max-w-md"><h3 className="font-semibold text-theme-text">Dosya açılamadı</h3><p className="mt-2 text-sm leading-relaxed text-theme-text-muted">{preview.message}</p><button type="button" onClick={() => setReloadToken(value => value + 1)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-xs font-semibold text-theme-text hover:bg-theme-surface-hover"><RefreshCw size={14} /> Tekrar dene</button></div></div>;
    }
  };

  return (
    <div data-testid="file-viewer" role="dialog" aria-modal="true" aria-label={`${file.name || 'Dosya'} önizlemesi`} className="jetwork-file-viewer fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-0 backdrop-blur-[2px] sm:p-5">
      <section className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-theme-bg shadow-2xl sm:h-[calc(100dvh-40px)] sm:max-w-[1180px] sm:rounded-[22px] sm:border sm:border-theme-border/70">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-theme-border/70 bg-theme-bg px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-theme-surface text-theme-text">{fileIcon(file, 'h-[18px] w-[18px]')}</span>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-theme-text">{file.name || 'JetWork dosyası'}</p><p className="text-[11px] text-theme-text-muted">{fileTypeLabel(file)}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => void downloadFile()} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text" title="Dosyayı indir"><Download size={15} /><span className="hidden sm:inline">İndir</span></button>
            <button ref={closeButtonRef} type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-theme-text-muted transition-colors hover:bg-theme-surface-hover hover:text-theme-text" title="Önizlemeyi kapat" aria-label="Önizlemeyi kapat"><X size={17} /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1">{renderPreview()}</div>
      </section>
    </div>
  );
}
