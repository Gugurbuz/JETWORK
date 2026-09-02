import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('office revision runtime wiring v2', () => {
  const source = readFileSync(
    new URL('../../../supabase/functions/_shared/artifactAssistantTool.ts', import.meta.url),
    'utf8',
  )

  it('re-inspects both source and generated output after edit execution', () => {
    expect(source).toContain("toolName === 'edit_office_file'")
    expect(source).toContain('inspectOfficeRef(client, workspaceId, sourceRef)')
    expect(source).toContain('inspectOfficeRef(client, workspaceId, outputRef)')
    expect(source).toContain('verifyOfficeRevisionInvariant')
  })

  it('fails closed and removes generated output on invariant or inspection failure', () => {
    expect(source).toContain('ARTIFACT_REVISION_INVARIANT_FAILED')
    expect(source).toContain('async function removeGeneratedArtifact')
    expect(source).toContain('client.storage.from(artifact.storageBucket).remove([artifact.storagePath])')
    expect(source).toMatch(/catch \(error\)[\s\S]*removeGeneratedArtifact\(client, outputRef\)[\s\S]*throw error/)
  })

  it('reports revision verification alongside persisted artifact integrity', () => {
    expect(source).toContain('revisionInvariantVerified: officeRevisionVerification?.verified ?? null')
    expect(source).toContain('requireVerifiedArtifactOutputs')
  })
})
