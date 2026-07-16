import { supabase } from '../supabase';
import { DocumentData } from '../types';
import { nowIso } from '../lib/mapping';

export interface DocumentPersistenceResult {
  ok: boolean;
  error?: string;
}

export const saveDocumentAndVersion = async (
  workspaceId: string,
  messageId: string,
  content: DocumentData,
): Promise<DocumentPersistenceResult> => {
  try {
    const { error } = await supabase.rpc('save_document_version', {
      p_workspace_id: workspaceId,
      p_message_id: messageId,
      p_content: content,
    });
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    console.error('Failed to save document and version:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
    return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
  }

  if (sectionContent.includes(targetText)) {
    return sectionContent.replace(targetText, replacementText);
  }

  console.warn('[DocumentUtils] Exact patch target was not found; appending replacement.');
  return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
};
