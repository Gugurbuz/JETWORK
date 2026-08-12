import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSessionMock,
  rpcMock,
  uploadMock,
  removeMock,
  invokeMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  rpcMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
    rpc: rpcMock,
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        remove: removeMock,
      })),
    },
    functions: {
      invoke: invokeMock,
    },
  },
}));

import { ingestKnowledgeFile } from '../knowledgeCatalogRepository';

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'user-1' } } },
    error: null,
  });
  rpcMock.mockResolvedValue({ data: 'space-1', error: null });
  uploadMock.mockResolvedValue({ error: null });
  removeMock.mockResolvedValue({ error: null });
  invokeMock.mockResolvedValue({
    data: {
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      jobId: 'job-1',
      objects: 2,
      relations: 1,
      parsedObjects: 2,
      parsedRelations: 1,
      deduplicated: false,
      publicationStatus: 'draft',
      warnings: [],
    },
    error: null,
  });
});

describe('ingestKnowledgeFile', () => {
  it('uses the cached session path and uploads into the resolved global knowledge space', async () => {
    const file = new File(['# CRM class inventory'], 'CRM_Class_Envanteri (1).md', {
      type: 'text/markdown',
    });

    const result = await ingestKnowledgeFile('workspace-1', file, 'global');

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('resolve_knowledge_space_v2', {
      p_workspace_id: 'workspace-1',
      p_scope_type: 'global',
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [storagePath, uploadedFile, options] = uploadMock.mock.calls[0];
    expect(storagePath).toMatch(/^user-1\/space-1\/[0-9a-f-]+\/CRM_Class_Envanteri-1\.md$/i);
    expect(uploadedFile).toBe(file);
    expect(options).toMatchObject({
      contentType: 'text/markdown',
      upsert: false,
      cacheControl: '3600',
    });
    expect(invokeMock).toHaveBeenCalledWith('ingest-knowledge-source', {
      body: {
        knowledgeSpaceId: 'space-1',
        storagePath,
        fileName: 'CRM_Class_Envanteri (1).md',
        mimeType: 'text/markdown',
      },
    });
    expect(result.sourceId).toBe('source-1');
  });

  it('turns a raw browser fetch failure into an actionable upload error', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'Failed to fetch' } });
    const file = new File(['test'], 'source.md', { type: 'text/markdown' });

    await expect(ingestKnowledgeFile('workspace-1', file, 'global')).rejects.toThrow(
      'Bilgi kaynağı dosyası yüklenirken Supabase bağlantısı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
