import { supabase } from '../supabase';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';
import type { DocumentData } from '../types';
import type { User } from '../hooks/useAuth';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { loadSharedAnalysis } from './documentShareRepository';

export interface SharedAnalysisImportResult {
  workspaceId: string;
  document: DocumentData;
}

function sanitizeSharedDocument(document: DocumentData): DocumentData {
  return {
    ...document,
    businessAnalysis: {
      ...document.businessAnalysis,
      content: sanitizeDocumentHtml(document.businessAnalysis?.content || ''),
    },
    ...(document.review
      ? {
          review: {
            ...document.review,
            content: sanitizeDocumentHtml(document.review.content || ''),
          },
        }
      : {}),
  };
}

export async function importSharedAnalysis(
  token: string,
  user: User,
): Promise<SharedAnalysisImportResult> {
  const shared = await loadSharedAnalysis(token);
  if (!shared) throw new Error('Paylasim bulunamadi, suresi doldu veya iptal edildi.');

  const projectId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const document = sanitizeSharedDocument(shared.data);

  const { error: projectError } = await supabase.from('projects').insert({
    id: projectId,
    name: 'Paylasilan Analiz',
    description: `Paylasim ${shared.shareId} uzerinden ice aktarildi.`,
    owner_id: user.uid,
    created_at: now,
    last_updated: now,
  });
  if (projectError) throw projectError;

  const { error: workspaceError } = await supabase.from('workspaces').insert({
    id: workspaceId,
    project_id: projectId,
    issue_key: `SHR-${workspaceId.slice(0, 8).toUpperCase()}`,
    title: 'Paylasilan Kavramsal Analiz',
    type: 'Analysis',
    status: 'Draft',
    owner_id: user.uid,
    collaborators: [],
    created_at: now,
    last_updated: now,
  });
  if (workspaceError) {
    await supabase.from('projects').delete().eq('id', projectId);
    throw workspaceError;
  }

  const persistence = await saveDocumentAndVersion(workspaceId, `share-${shared.shareId}`, document);
  if (!persistence.ok) {
    await supabase.from('workspaces').delete().eq('id', workspaceId);
    await supabase.from('projects').delete().eq('id', projectId);
    throw new Error(persistence.error || 'Paylasilan dokuman kaydedilemedi.');
  }

  return { workspaceId, document };
}
