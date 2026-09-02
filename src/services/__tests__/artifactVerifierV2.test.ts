import { describe, expect, it } from 'vitest'
import { verifyGeneratedArtifacts } from '../../../supabase/functions/_shared/artifact/verifier.ts'

const generated = [{
  attachmentId: 'att-1',
  name: 'analysis.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  storageBucket: 'assistant-files',
  storagePath: 'workspace/output/analysis.docx',
}]

describe('Artifact verifier v2', () => {
  it('requires persisted reload before artifact integrity can pass', async () => {
    const result = await verifyGeneratedArtifacts({ generated, reload: async () => null })
    expect(result.reloadVerified).toBe(false)
    expect(result.integrityVerified).toBe(false)
    expect(result.failures[0]).toContain('reload_failed')
  })

  it('accepts a non-empty reloaded artifact with matching identity and valid digest', async () => {
    const result = await verifyGeneratedArtifacts({
      generated,
      reload: async artifact => ({
        ...artifact,
        byteSize: 12_345,
        sha256: 'a'.repeat(64),
      }),
    })
    expect(result.reloadVerified).toBe(true)
    expect(result.integrityVerified).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails closed on storage identity mismatch or empty bytes', async () => {
    const result = await verifyGeneratedArtifacts({
      generated,
      reload: async artifact => ({
        ...artifact,
        storagePath: 'workspace/output/other.docx',
        byteSize: 0,
      }),
    })
    expect(result.reloadVerified).toBe(true)
    expect(result.integrityVerified).toBe(false)
    expect(result.failures).toContain('path_mismatch:att-1')
    expect(result.failures).toContain('empty_artifact:att-1')
  })
})
