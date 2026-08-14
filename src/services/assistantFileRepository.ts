import { supabase } from '../supabase';
import type { MessageAttachment } from '../types';

export const ASSISTANT_FILES_BUCKET = 'assistant-files';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ASSISTANT_FILE_BYTES = 20 * 1024 * 1024;

const sanitizeFileName = (name: string): string => {
  const cleaned = String(name || 'workbook.xlsx')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-180);
  return cleaned || 'workbook.xlsx';
};

export const isSpreadsheetExecutionAttachment = (
  attachment: Pick<MessageAttachment, 'name' | 'mimeType'>,
): boolean => (
  /\.xlsx$/i.test(attachment.name || '')
  || attachment.mimeType === XLSX_MIME
);

const shouldPersistAsToolInput = (attachment: MessageAttachment): boolean => (
  attachment.purpose === 'tool_input'
  || (
    attachment.purpose !== 'knowledge_bank'
    && attachment.purpose !== 'tool_output'
    && isSpreadsheetExecutionAttachment(attachment)
  )
);

const dataUrlToBlob = (attachment: MessageAttachment): Blob | null => {
  if (!attachment.data) return null;
  const bytes = Uint8Array.from(atob(attachment.data), character => character.charCodeAt(0));
  return new Blob([bytes], { type: attachment.mimeType || XLSX_MIME });
};

const attachmentBlob = (attachment: MessageAttachment): Blob | null => (
  attachment.file || dataUrlToBlob(attachment)
);

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
      if (!isSpreadsheetExecutionAttachment(attachment)) {
        throw new Error(`Dosya işlemi için yalnız XLSX destekleniyor: ${attachment.name || 'Dosya'}`);
      }
      if (attachment.storageBucket === ASSISTANT_FILES_BUCKET && attachment.storagePath) {
        persisted.push({
          ...attachment,
          purpose: 'tool_input',
          file: undefined,
          data: undefined,
          url: '',
        });
        continue;
      }

      const file = attachmentBlob(attachment);
      if (!file) throw new Error(`${attachment.name || 'Dosya'} içeriği artık mevcut değil; dosyayı yeniden ekleyin.`);
      if (file.size > MAX_ASSISTANT_FILE_BYTES) {
        throw new Error(`${attachment.name || 'Dosya'} 20 MB dosya işlemi sınırını aşıyor.`);
      }

      const attachmentId = attachment.attachmentId || crypto.randomUUID();
      const fileName = sanitizeFileName(attachment.name || 'workbook.xlsx');
      const storagePath = `${authData.user.id}/${workspaceId}/inputs/${attachmentId}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(ASSISTANT_FILES_BUCKET)
        .upload(storagePath, file, {
          contentType: XLSX_MIME,
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      persisted.push({
        ...attachment,
        attachmentId,
        name: fileName,
        mimeType: XLSX_MIME,
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
    if (uploadedPaths.length) {
      await supabase.storage.from(ASSISTANT_FILES_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
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
    download: attachment.name || 'jetwork-output.xlsx',
  });
  if (error || !data?.signedUrl) throw error || new Error('İndirme bağlantısı oluşturulamadı.');
  return data.signedUrl;
}
