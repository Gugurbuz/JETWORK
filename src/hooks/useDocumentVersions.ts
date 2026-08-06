import { useCallback, useEffect, useState } from 'react';
import type { DocumentData } from '../types';
import {
  commitDocumentVersion,
  getDocumentHead,
  listDocumentVersions,
  type CommitDocumentVersionInput,
  type CommitDocumentVersionResult,
  type DocumentHead,
  type DocumentVersionRecord,
} from '../services/documentVersionRepository';

const EMPTY_HEAD: DocumentHead = {
  currentVersionId: null,
  currentVersionNumber: 0,
  content: null,
  contentHash: null,
};

export interface DocumentVersionRefreshResult {
  head: DocumentHead;
  versions: DocumentVersionRecord[];
}

export function useDocumentVersions(workspaceId: string | null, documentId = 'main') {
  const [head, setHead] = useState<DocumentHead>(EMPTY_HEAD);
  const [versions, setVersions] = useState<DocumentVersionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<DocumentVersionRefreshResult> => {
    if (!workspaceId) {
      setHead(EMPTY_HEAD);
      setVersions([]);
      setError(null);
      return { head: EMPTY_HEAD, versions: [] };
    }

    setIsLoading(true);
    setError(null);

    try {
      const [nextHead, nextVersions] = await Promise.all([
        getDocumentHead(workspaceId, documentId),
        listDocumentVersions(workspaceId, documentId),
      ]);

      setHead(nextHead);
      setVersions(nextVersions);
      return { head: nextHead, versions: nextVersions };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    } finally {
      setIsLoading(false);
    }
  }, [documentId, workspaceId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const commit = useCallback(async (
    content: DocumentData,
    options: Omit<CommitDocumentVersionInput, 'workspaceId' | 'documentId' | 'content'>,
  ): Promise<CommitDocumentVersionResult> => {
    if (!workspaceId) throw new Error('Aktif çalışma alanı bulunamadı.');

    setError(null);
    try {
      const result = await commitDocumentVersion({
        workspaceId,
        documentId,
        content,
        ...options,
      });
      await refresh();
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    }
  }, [documentId, refresh, workspaceId]);

  return {
    head,
    versions,
    isLoading,
    error,
    refresh,
    commit,
  };
}
