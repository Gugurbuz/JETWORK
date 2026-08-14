import { supabase } from '../supabase';
import type { MessageAttachment } from '../types';

export const ASSISTANT_FILES_BUCKET = 'assistant-files';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_ASSISTANT_FILE_BYTES = 20 * 1024 * 1024;

const ACTIONABLE_EXTENSIONS = /\.(xlsx|pdf|docx|pptx|png|jpe?g|webp|gif|svg|csv|tsv|txt|md|json)$/i;
const ACTIONABLE_MIME_TYPES = new Set([
  XLSX_MIME,
  PDF_MIME,
  DOCX_MIME,
  PPTX_MIME,
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'text/csv',
  'text/tab-separated-values',
  'text/plain',
  'text/markdown',
  'application/json',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  xlsx: XLSX_MIME,
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

const sanitizeFileName = (name: string): string => {
  const cleaned = String(name || 'jetwork-file')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-180);
  return cleaned || 'jetwork-file';
};

const extensionOf = (name?: string) => String(name || '').split('.').pop()?.toLocaleLowerCase('en-US') || '';

export const normalizedAssistantFileMime = (
  attachment: Pick<MessageAttachment, 'name' | 'mimeType'>,
): string => {
  const mime = String(attachment.mimeType || '').trim().toLocaleLowerCase('en-US');
  const extensionMime = MIME_BY_EXTENSION[extensionOf(attachment.name)];
  if (extensionMime) return extensionMime;
  if (ACTIONABLE_MIME_TYPES.has(mime)) return mime;
  return mime || 'application/octet-stream';
};

export const isActionableExecutionAttachment = (
  attachment: Pick<MessageAttachment, 'name' | 'mimeType'>,
): boolean => (
  ACTIONABLE_EXTENSIONS.test(attachment.name || '')
  || ACTIONABLE_MIME_TYPES.has(String(attachment.mimeType || '').toLocaleLowerCase('en-US'))
);

export const isSpreadsheetExecutionAttachment = (
  attachment: Pick<MessageAttachment, 'name' | 'mimeType'>,
): boolean => (
  /\.xlsx$/i.test(attachment.name || '')
  || normalizedAssistantFileMime(attachment) === XLSX_MIME
);

const shouldPersistAsToolInput = (attachment: MessageAttachment): boolean => (
  attachment.purpose === 'tool_input'
  || (
    attachment.purpose !== 'knowledge_bank'
    && attachment.purpose !== 'tool_output'
    && isActionableExecutionAttachment(attachment)
  )
);

const dataUrlToBlob = (attachment: MessageAttachment): Blob | null => {
  if (!attachment.data) return null;
  const bytes = Uint8Array.from(atob(attachment.data), character => character.charCodeAt(0));
  return new Blob([bytes], { type: normalizedAssistantFileMime(attachment) });
};

const attachmentBlob = (attachment: MessageAttachment): Blob | null => attachment.file || dataUrlToBlob(attachment);

export async function persistAssistantToolAttachments(
  workspaceId: string,
  attachments: MessageAttachment[] = [],
): Promise<MessageAttachment[]> {
  const toolInputs = attachments.filter(shouldPersistAsToolInput);
  if (!toolInputs.length) return attachments;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user || authData.user.is_anonymous) {
    throw authError || new Error('Dosya işlemi için kalıcı kullanıcı oturumu gerekiyor.');
  }

  const uploadedPaths: string[] = [];
  try {
    const persisted: MessageAttachment[] = [];
    for (const attachment of attachments) {
      if (!shouldPersistAsToolInput(attachment)) {
        persisted.push(attachment);
        continue;
      }
      if (!isActionableExecutionAttachment(attachment)) {
        throw new Error(`Bu dosya türü JetWork action runtime tarafından desteklenmiyor: ${attachment.name || 'Dosya'}`);
      }
      const mimeType = normalizedAssistantFileMime(attachment);
      if (attachment.storageBucket === ASSISTANT_FILES_BUCKET && attachment.storagePath) {
        persisted.push({ ...attachment, mimeType, purpose: 'tool_input', file: undefined, data: undefined, url: '' });
        continue;
      }

      const file = attachmentBlob(attachment);
      if (!file) throw new Error(`${attachment.name || 'Dosya'} içeriği artık mevcut değil; dosyayı yeniden ekleyin.`);
      if (file.size > MAX_ASSISTANT_FILE_BYTES) throw new Error(`${attachment.name || 'Dosya'} 20 MB dosya işlemi sınırını aşıyor.`);

      const attachmentId = attachment.attachmentId || crypto.randomUUID();
      const fileName = sanitizeFileName(attachment.name || `jetwork-file.${extensionOf(attachment.name) || 'bin'}`);
      const storagePath = `${authData.user.id}/${workspaceId}/inputs/${attachmentId}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(ASSISTANT_FILES_BUCKET)
        .upload(storagePath, file, { contentType: mimeType, cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      persisted.push({
        ...attachment,
        attachmentId,
        name: fileName,
        mimeType,
        purpose: 'tool_input',
        storageBucket: ASSISTANT_FILES_BUCKET,
        storagePath,
        file: undefined,
        data: undefined,
        url: '',
      });
    }
    return persisted;
  } catch (error) {
    if (uploadedPaths.length) await supabase.storage.from(ASSISTANT_FILES_BUCKET).remove(uploadedPaths).catch(() => undefined);
    throw error;
  }
}

export async function createAssistantFileDownloadUrl(
  attachment: Pick<MessageAttachment, 'storageBucket' | 'storagePath' | 'name'>,
  expiresInSeconds = 120,
): Promise<string> {
  const bucket = String(attachment.storageBucket || '').trim();
  const path = String(attachment.storagePath || '').trim();
  if (!bucket || !path) throw new Error('Dosya artifact referansı eksik.');
  if (bucket !== ASSISTANT_FILES_BUCKET) throw new Error('Dosya artifact bucket değeri geçersiz.');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds, {
    download: attachment.name || 'jetwork-output',
  });
  if (error || !data?.signedUrl) throw error || new Error('İndirme bağlantısı oluşturulamadı.');
  return data.signedUrl;
}
