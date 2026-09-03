import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/_shared/capabilities/controllerSurface.ts', 'utf8')

describe('Agent Controller V2 candidate verification protocol', () => {
  it('requires exact/detail verification before repeated broad search', () => {
    expect(source).toContain('the next knowledge call MUST be an exact/detail verification call')
    expect(source).toContain('before search_knowledge_catalog is called again')
    expect(source).toContain('the immediately following knowledge call must verify a returned candidate')
    expect(source).toContain('Do not loop over query/objectTypes variations while an unverified non-empty candidate is available')
  })

  it('requires materially relevant plural candidates to be verified before exhaustive finalization', () => {
    expect(source).toContain('exact-verify every materially relevant candidate within the safe tool budget before finalizing')
    expect(source).toContain('do not stop after only the first candidate')
    expect(source).toContain('never present a full-limit relation page as exhaustive')
  })
})
