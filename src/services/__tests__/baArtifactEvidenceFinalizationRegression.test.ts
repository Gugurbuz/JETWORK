import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

describe('BA artifact evidence and finalization recovery', () => {
  const router = fs.readFileSync('supabase/functions/openai-assistant-v2-entry-router/index.ts', 'utf8')
  const core = fs.readFileSync('supabase/functions/openai-assistant-core-v2/implementation.ts', 'utf8')

  it('prefers a substantive prior requirement over repeated short follow-ups', () => {
    expect(router).toContain('clean(row.text, 26_000).length >= 400')
    expect(router).toContain('clean(row.text, 26_000) !== currentUserText')
    expect(router).toContain('loadRecentArtifactContext(client, workspaceId, messageId, message)')
  })

  it('returns empty enterprise evidence to the controller instead of forcing a fixed research sequence', () => {
    expect(core).toContain('ENTERPRISE_EVIDENCE_EMPTY_REVISE_ARTIFACT')
    expect(core).toContain('enterprise_artifact_evidence_retry')
    expect(core).toContain('Kurumsal kanıt henüz doğrulanmadı')
    expect(core).toContain('Controller olarak sıradaki aksiyona sen karar ver')
  })

  it('recovers a completed artifact when later narration/finalization fails', () => {
    expect(core).toContain('artifact_finalization_recovered')
    expect(core).toContain('recoveredArtifact: true')
    expect(core).toContain("const recoveryText = 'Doküman oluşturuldu.'")
  })
})