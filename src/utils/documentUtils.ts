import type { DocumentData } from '../types';
import { nowIso } from '../lib/mapping';
import { supabase } from '../supabase';
import {
  commitDocumentVersion,
  getDocumentHead,
  type DocumentChangeSource,
} from '../services/documentVersionRepository';

export interface DocumentPersistenceResult {
  ok: boolean;
  error?: string;
  versionId?: string;
  versionNumber?: number;
}

export interface SaveDocumentVersionOptions {
  expectedCurrentVersionId?: string | null;
  changeSource?: DocumentChangeSource;
  changeSummary?: string;
  changedSections?: string[];
  provider?: string | null;
  model?: string | null;
  idempotencyKey?: string;
}

function inferChangeSource(messageId: string): DocumentChangeSource {
  if (messageId.startsWith('manual-')) return 'MANUAL';
  if (messageId.startsWith('restore-')) return 'RESTORE';
  if (messageId.startsWith('template-')) return 'TEMPLATE';
  if (messageId.startsWith('import-')) return 'IMPORT';
  return 'AI';
}

function defaultSummary(source: DocumentChangeSource): string {
  switch (source) {
    case 'MANUAL': return 'Doküman manuel olarak düzenlendi';
    case 'RESTORE': return 'Geçmiş doküman sürümü geri yüklendi';
    case 'TEMPLATE': return 'Doküman şablonu değiştirildi';
    case 'IMPORT': return 'Doküman içe aktarıldı';
    case 'SYSTEM': return 'Sistem dokümanı güncelledi';
    case 'AI':
    default:
      return 'AI dokümanı güncelledi';
  }
}

export const saveDocumentAndVersion = async (
  workspaceId: string,
  messageId: string,
  content: DocumentData,
  options: SaveDocumentVersionOptions = {},
): Promise<DocumentPersistenceResult> => {
  try {
    const source = options.changeSource || inferChangeSource(messageId);
    const head = options.expectedCurrentVersionId === undefined
      ? await getDocumentHead(workspaceId, 'main')
      : null;

    const result = await commitDocumentVersion({
      workspaceId,
      documentId: 'main',
      content,
      expectedCurrentVersionId:
        options.expectedCurrentVersionId === undefined
          ? head?.currentVersionId || null
          : options.expectedCurrentVersionId,
      changeSource: source,
      changeSummary: options.changeSummary || defaultSummary(source),
      changedSections: options.changedSections || content.artifactMeta?.changedSections || [],
      sourceMessageId: messageId,
      idempotencyKey: options.idempotencyKey || messageId,
      provider: options.provider || null,
      model: options.model || null,
    });

    return {
      ok: true,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
    };
  } catch (error) {
    console.error('Failed to save document and version:', error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const saveRawResponse = async (
  workspaceId: string,
  messageId: string,
  rawText: string,
  parsedData: unknown,
): Promise<void> => {
  try {
    const { error } = await supabase.from('raw_responses').upsert({
      id: messageId,
      workspace_id: workspaceId,
      message_id: messageId,
      raw_text: rawText,
      parsed_data: parsedData || null,
      created_at: nowIso(),
    });
    if (error) throw error;
  } catch (error) {
    console.error('Failed to save raw response:', error);
  }
};

export const applyPatch = (
  sectionContent: string,
  targetText: string,
  replacementText: string,
): string => {
  if (!targetText) {
    return sectionContent ? `${sectionContent}\n\n${replacementText}` : replacementText;
  }

  if (sectionContent.includes(targetText)) {
    return sectionContent.replace(targetText, replacementText);
  }

  console.warn('[DocumentUtils] Exact patch target was not found; appending replacement.');
  return sectionContent ? `${sectionContent}\n\n${replacementText}` : replacementText;
};
