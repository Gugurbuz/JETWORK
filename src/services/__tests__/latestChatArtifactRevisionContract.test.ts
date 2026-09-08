import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const artifactToolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/artifactAssistantTool.ts', import.meta.url),
  'utf8',
)
const controllerPolicySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)
const goldenSource = readFileSync(
  new URL('../../evaluation/agenticRuntimeV2Scenarios.ts', import.meta.url),
  'utf8',
)

describe('latest production chat hardening contract', () => {
  it('allows previously generated assistant outputs to become safe revision inputs', () => {
    expect(artifactToolSource).toContain("const ACTIONABLE_PURPOSES = new Set(['tool_input', 'tool_output'])")
    expect(artifactToolSource).toContain('ACTIONABLE_PURPOSES.has(purpose)')
    expect(artifactToolSource).toContain("toolName === 'edit_office_file'")
  })

  it('keeps the existing reload + office revision invariant verifier in the edit path', () => {
    expect(artifactToolSource).toContain('verifyOfficeRevisionInvariant')
    expect(artifactToolSource).toContain('revisionInvariantVerified: officeRevisionVerification?.verified ?? null')
    expect(artifactToolSource).toContain('ARTIFACT_REVISION_INVARIANT_FAILED')
  })

  it('keeps evidence sufficiency and narrow artifact revision as controller decisions', () => {
    expect(controllerPolicySource).toContain('Kanıt stratejisinin amacı daha fazla arama yapmak değil')
    expect(controllerPolicySource).toContain('Mevcut veya bu konuşmada daha önce üretilmiş bir artifact')
    expect(controllerPolicySource).toContain('edit_office_file')
    expect(controllerPolicySource).toContain('Baştan `create_document_file` ile yeniden üretmeyi ancak')
  })

  it('locks the observed ZCRM2-356 -> artifact revision flow into the golden suite', () => {
    expect(goldenSource).toContain('agent-v2-04b-latest-chat-revision-continuity')
    expect(goldenSource).toContain('talep no = SAGILE-22333')
    expect(goldenSource).toContain("'edit_office_file'")
    expect(goldenSource).toContain("'revision_invariant_verified'")
  })
})
