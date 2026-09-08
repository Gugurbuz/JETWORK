import type { MessageAttachment } from '../../types';

export type WorkspaceFileKind = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image';
export type FileVisualKind = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'image' | 'file';

export interface FileVisualMeta {
  kind: FileVisualKind;
  fileKind: WorkspaceFileKind;
  label: string;
  mark: string;
  tileClass: string;
}

export const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

export const fileVisualMeta = (file: Pick<MessageAttachment, 'name' | 'mimeType'>): FileVisualMeta => {
  const ext = extensionOf(file.name);
  const mime = String(file.mimeType || '').toLocaleLowerCase('en-US');
  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    return { kind: 'word', fileKind: 'document', label: 'Word belgesi', mark: 'W', tileClass: 'border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400' };
  }
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) {
    return { kind: 'excel', fileKind: 'spreadsheet', label: 'Excel çalışma kitabı', mark: 'X', tileClass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' };
  }
  if (['pptx', 'ppt'].includes(ext) || mime.includes('presentation')) {
    return { kind: 'powerpoint', fileKind: 'presentation', label: 'PowerPoint sunumu', mark: 'P', tileClass: 'border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400' };
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return { kind: 'pdf', fileKind: 'pdf', label: 'PDF belgesi', mark: 'PDF', tileClass: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400' };
  }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
    return { kind: 'image', fileKind: 'image', label: 'Görsel', mark: 'IMG', tileClass: 'border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400' };
  }
  return {
    kind: 'file',
    fileKind: 'document',
    label: ext ? `${ext.toLocaleUpperCase('tr-TR')} dosyası` : 'Dosya',
    mark: 'FILE',
    tileClass: 'border-theme-border bg-theme-surface text-theme-text-muted',
  };
};

export const formatFileSize = (bytes?: number | null): string => {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '';
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};
