import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/_shared/capabilities/controllerSurface.ts', 'utf8')
const toolsSource = readFileSync('supabase/functions/_shared/assistantTools.ts', 'utf8')
const manifestSource = readFileSync('supabase/functions/_shared/capabilityManifest.ts', 'utf8')

describe('Agent Controller V2 candidate verification protocol', () => {
  it('requires exact/detail verification before repeated broad search', () => {
    expect(source).toContain('before another broad search is attempted')
    expect(source).toContain('Do not loop over query/objectTypes variations while an unverified non-empty candidate is available')
    expect(toolsSource).toContain('pendingSearchVerificationByClient')
    expect(toolsSource).toContain('SEARCH_CANDIDATES_REQUIRE_EXACT_VERIFICATION')
    expect(toolsSource).toContain('protocolBlocked: true')
    expect(toolsSource).toContain('clearPendingSearchVerification(client)')
  })

  it('uses bounded batch exact verification for plural candidate sets', () => {
    expect(source).toContain('use get_knowledge_objects to exact-verify the materially relevant returned canonicalKeys together')
    expect(source).toContain('do not stop after only the first candidate')
    expect(toolsSource).toContain("name: 'get_knowledge_objects'")
    expect(toolsSource).toContain('maxItems: MAX_BATCH_EXACT_OBJECTS')
    expect(toolsSource).toContain("if (toolName === 'get_knowledge_objects') return getExactObjects")
    expect(manifestSource).toContain("'get_knowledge_objects'")
  })

  it('preserves a canonical message-code index from the full verified ABAP source', () => {
    expect(toolsSource).toContain('[VERIFIED_ABAP_MESSAGE_CODES]')
    expect(toolsSource).toContain('extractAbapMessageCodes')
    expect(source).toContain('enumerate every code in that block without omission')
    expect(source).toContain('never present a full-limit relation page as exhaustive')
  })
})
