import { describe, expect, it, vi } from 'vitest'
import {
  requireVerifiedArtifactOutputs,
  verifyPersistedArtifactOutputs,
} from '../../../supabase/functions/_shared/artifact/storageVerifier.ts'

const artifact = {
  attachmentId: 'att-1',
  name: 'analysis.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  storageBucket: 'assistant-files',
  storagePath: 'user/workspace/outputs/att-1/analysis.docx',
}

const storageClient = (downloadResult: { data: Blob | null; error: unknown }) => ({
  storage: {
    from: vi.fn(() => ({
      download: vi.fn(async () => downloadResult),
    })),
  },
})

describe('persisted artifact storage verifier v2', () => {
  it('reloads persisted bytes and produces a valid sha256 integrity observation', async () => {
    const client = storageClient({ data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null })
    const result = await verifyPersistedArtifactOutputs(client, [artifact])

    expect(result.reloadVerified).toBe(true)
    expect(result.integrityVerified).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.artifacts[0].byteSize).toBe(4)
    expect(result.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(client.storage.from).toHaveBeenCalledWith('assistant-files')
  })

  it('fails closed when storage reload cannot find the generated output', async () => {
    const client = storageClient({ data: null, error: new Error('not found') })
    const result = await verifyPersistedArtifactOutputs(client, [artifact])

    expect(result.reloadVerified).toBe(false)
    expect(result.integrityVerified).toBe(false)
    expect(result.failures).toContain('reload_failed:att-1')
  })

  it('prevents callers from treating an unverified artifact as complete', async () => {
    const client = storageClient({ data: new Blob([]), error: null })
    await expect(requireVerifiedArtifactOutputs(client, [artifact]))
      .rejects.toThrow('ARTIFACT_VERIFICATION_FAILED')
  })
})
