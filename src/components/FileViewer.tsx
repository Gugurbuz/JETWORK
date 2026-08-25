import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as mammoth from 'mammoth';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, RefreshCw, X } from 'lucide-react';
import type { MessageAttachment } from '../types';
import { supabase } from '../supabase';
import { JetWorkLogo } from './JetWorkLogo';
import './file-viewer-loading.css';
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
  sheets: Array<{ name: string; rows: Array<{ row: number; values: string[] }> }>;
};

type PresentationPreview = {
  kind: 'presentation';
  slides: Array<{ number: number; title: string; blocks: Array<{ text: string }> }>;
};

type PreviewPayload = SpreadsheetPreview | PresentationPreview;
type PreviewState =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; url: string; rendition?: boolean }
  | { kind: 'docx'; html: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'structured'; payload: PreviewPayload }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

type FileWithPreview = MessageAttachment & {
  previewUrl?: string;
  previewStoragePath?: string;
  previewStorageBucket?: string;
};

interface FileViewerProps {
  file: MessageAttachment;
  onClose: () => void;
}

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

async function signedFileUrl(file: MessageAttachment, download = false): Promise<string> {
  if (file.storageBucket && file.storagePath) {
    if (file.storageBucket !== ASSISTANT_FILES_BUCKET) throw new Error('Dosya konumu geçersiz.');
    const { data, error } = await supabase.storage.from(file.storageBucket).createSignedUrl(
      file.storagePath,
      5 * 60,
      download ? { download: file.name || 'jetwork-dosya' } : undefined,
    );
    if (error || !data?.signedUrl) throw error || new Error('Dosya bağlantısı oluşturulamadı.');
    return data.signedUrl;
  }
  if (file.url) return file.url;
  throw new Error('Dosya referansı bulunamadı.');
}

async function preferredDocxRendition(file: MessageAttachment): Promise<string | null> {
  const candidate = file as FileWithPreview;
  if (candidate.previewUrl) return candidate.previewUrl;
  if (!candidate.previewStoragePath) return null;
  const bucket = candidate.previewStorageBucket || file.storageBucket || ASSISTANT_FILES_BUCKET;
  if (bucket !== ASSISTANT_FILES_BUCKET) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(candidate.previewStoragePath, 5 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function fetchChecked(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dosya okunamadı (${response.status}).`);
  return response;
}

function SpreadsheetView({ preview }: { preview: SpreadsheetPreview }) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = preview.sheets[sheetIndex];
  if (!sheet) return <div className="p-8 text-sm text-theme-text-muted">Çalışma sayfası bulunamadı.</div>;
  const columnCount = Math.max(1, ...sheet.rows.map(row => row.values.length));
  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-slate-900">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2">
        {preview.sheets.map((item, index) => (
          <button key={`${item.name}-${index}`} type="button" onClick={() => setSheetIndex(index)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${index === sheetIndex ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200/70'}`}>
            {item.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <tbody>
            {sheet.rows.map(row => (
              <tr key={row.row}>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex} className="min-w-28 border border-slate-200 px-3 py-2 align-top whitespace-pre-wrap">{row.values[columnIndex] || ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PresentationView({ preview }: { preview: PresentationPreview }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = preview.slides[slideIndex];
  if (!slide) return <div className="p-8 text-sm text-theme-text-muted">Slayt bulunamadı.</div>;
  return (
    <div className="flex h-full min-h-0 bg-slate-100">
      <aside className="hidden w-40 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2 md:block">
        {preview.slides.map((item, index) => (
          <button key={item.number} type="button" onClick={() => setSlideIndex(index)} className={`mb-2 w-full rounded-lg border p-2 text-left ${index === slideIndex ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <div className="text-[10px] text-slate-400">{item.number}</div>
            <div className="mt-1 line-clamp-3 text-[11px] font-medium text-slate-700">{item.title}</div>
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto p-6 sm:p-10">
        <article className="mx-auto aspect-[16/9] w-full max-w-5xl bg-white p-10 shadow-sm">
          <h1 className="mb-6 text-3xl font-semibold tracking-tight text-slate-900">{slide.title}</h1>
          <div className="space-y-4 text-base leading-relaxed text-slate-700">
            {slide.blocks.map((block, index) => <p key={index} className="whitespace-pre-wrap">{block.text}</p>)}
          </div>
        </article>
      </div>
    </div>
  );
}

export function FileViewer({ file, onClose }: FileViewerProps) {
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mime = useMemo(() => normalizedAssistantFileMime(file), [file]);
  const extension = extensionOf(file.name);

  const load = useCallback(async () => {
    setPreview({ kind: 'loading' });
    try {
      const url = await signedFileUrl(file);
      if (mime.startsWith('image/')) return setPreview({ kind: 'image', url });
      if (mime === PDF_MIME || extension === 'pdf') return setPreview({ kind: 'pdf', url });
      if (mime === DOCX_MIME || extension === 'docx') {
        const renditionUrl = await preferredDocxRendition(file);
        if (renditionUrl) return setPreview({ kind: 'pdf', url: renditionUrl, rendition: true });
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
      if (mime.startsWith('text/') || mime === 'application/json' || ['txt', 'csv', 'tsv', 'json', 'xml'].includes(extension)) {
        return setPreview({ kind: 'text', text: await (await fetchChecked(url)).text() });
      }
      setPreview({ kind: 'unsupported' });
    } catch (error) {
      setPreview({ kind: 'error', message: error instanceof Error ? error.message : 'Dosya açılamadı.' });
    }
  }, [extension, file, mime]);

  useEffect(() => { void load(); }, [load, reloadToken]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const download = async () => {
    const url = await signedFileUrl(file, true);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name || 'jetwork-dosya';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const body = (() => {
    if (preview.kind === 'loading') return (
      <div className="jetwork-file-loader" aria-live="polite" aria-label="Dosya açılıyor">
        <div className="jetwork-file-loader-mark" aria-hidden="true">
          <JetWorkLogo className="jetwork-file-loader-logo" />
        </div>
        <div className="jetwork-file-loader-text">Dosya açılıyor…</div>
      </div>
    );
    if (preview.kind === 'image') return <div className="flex h-full items-center justify-center overflow-auto bg-slate-100 p-6"><img src={preview.url} alt={file.name || 'Dosya'} className="max-h-full max-w-full object-contain shadow-sm" /></div>;
    if (preview.kind === 'pdf') return <iframe title={file.name || 'PDF'} src={preview.url} className="h-full w-full border-0 bg-white" />;
    if (preview.kind === 'docx') return <div className="h-full overflow-auto bg-slate-100 px-4 py-8 sm:px-8"><article className="artifact-docx-page prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-sm sm:px-14 sm:py-14" dangerouslySetInnerHTML={{ __html: preview.html }} /></div>;
    if (preview.kind === 'markdown') return <div className="h-full overflow-auto bg-slate-100 px-4 py-8 sm:px-8"><article className="prose prose-sm mx-auto min-h-full max-w-[860px] bg-white px-8 py-10 text-slate-900 shadow-sm sm:px-14 sm:py-14"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown></article></div>;
    if (preview.kind === 'text') return <div className="h-full overflow-auto bg-slate-50 p-6"><pre className="mx-auto max-w-5xl whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-5 text-xs leading-relaxed text-slate-800">{preview.text}</pre></div>;
    if (preview.kind === 'structured') return preview.payload.kind === 'spreadsheet' ? <SpreadsheetView preview={preview.payload} /> : <PresentationView preview={preview.payload} />;
    if (preview.kind === 'unsupported') return <div className="flex h-full items-center justify-center p-8 text-center"><div><FileText className="mx-auto mb-3 text-theme-text-muted" /><h3 className="font-semibold text-theme-text">Bu dosya türü uygulama içinde önizlenemiyor</h3><p className="mt-2 text-sm text-theme-text-muted">Orijinal dosyayı indirerek açabilirsiniz.</p></div></div>;
    return <div className="flex h-full items-center justify-center p-8 text-center"><div><h3 className="font-semibold text-theme-text">Dosya açılamadı</h3><p className="mt-2 text-sm text-theme-text-muted">{preview.message}</p><button type="button" onClick={() => setReloadToken(value => value + 1)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-theme-border px-3 py-2 text-xs font-semibold"><RefreshCw size={14} /> Tekrar dene</button></div></div>;
  })();

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-0 backdrop-blur-[2px] sm:p-5" role="dialog" aria-modal="true" aria-label={`${file.name || 'Dosya'} önizleme`}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-theme-bg shadow-2xl sm:h-[94vh] sm:max-w-[1280px] sm:rounded-2xl sm:border sm:border-theme-border/70">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-theme-border/70 bg-theme-bg px-3 sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-theme-text">{file.name || 'Dosya'}</p>
            <p className="text-[11px] text-theme-text-muted">{extension.toUpperCase() || 'DOSYA'}</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void download()} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" title="Dosyayı indir"><Download size={15} /><span className="hidden sm:inline">İndir</span></button>
            <button ref={closeButtonRef} type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text" aria-label="Önizlemeyi kapat" title="Kapat"><X size={18} /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    </div>
  );
}
