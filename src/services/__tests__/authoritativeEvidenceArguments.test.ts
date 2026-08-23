import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsAuthoritativeEvidence.ts', import.meta.url),
  'utf8',
)

describe('authoritative evidence prepass argument normalization', () => {
  it('maps native exact lookup argument names to resolver query', () => {
    expect(source).toContain('args.technicalReference')
    expect(source).toContain('args.messageCode')
    expect(source).toContain('args.canonicalKey')
    expect(source).toContain('return query ? { query } : null')
  })

  it('never lets an authoritative prepass failure block the requested tool', () => {
    expect(source).toContain('AUTHORITATIVE_EVIDENCE_PREPASS_FAILED')
    expect(source).toContain('return evidenceExecuteAssistantTool(client, workspaceId, toolName, rawArguments)')
  })
})
