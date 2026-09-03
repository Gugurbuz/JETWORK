import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/_shared/capabilities/controllerSurface.ts', 'utf8')
const policySource = readFileSync('supabase/functions/_shared/agent/controllerPolicy.ts', 'utf8')
const toolsSource = readFileSync('supabase/functions/_shared/assistantTools.ts', 'utf8')
const manifestSource = readFileSync('supabase/functions/_shared/capabilityManifest.ts', 'utf8')

describe('Agent Controller V2 candidate verification protocol', () => {
  it('requires exact/detail verification before repeated broad search', () => {
    expect(source).toContain('before another broad search is attempted')
    expect(source).toContain('Do not loop over query/objectTypes variations while an unverified non-empty candidate is available')
    expect(toolsSource).toContain('pendingSearchVerificationByClient')
    expect(toolsSource).toContain('SEARCH_CANDIDATES_REQUIRE_EXACT_VERIFICATION')
    expect(toolsSource).toContain('protocolBlocked: true')
    expect(toolsSource).toContain('markPendingSearchVerified')
    expect(toolsSource).not.toContain('clearPendingSearchVerification(client)')
    expect(toolsSource).toContain('pending.candidateKeys.filter(candidateKey => !verified.has(candidateKey))')
  })

  it('uses bounded batch exact verification for plural candidate sets', () => {
    expect(source).toContain('use get_knowledge_objects to exact-verify ALL materially relevant returned canonicalKeys')
    expect(source).toContain('all three must be exact-verified before finalizing')
    expect(source).toContain('do not stop after only the first candidate or first two candidates')
    expect(toolsSource).toContain("name: 'get_knowledge_objects'")
    expect(toolsSource).toContain('maxItems: MAX_BATCH_EXACT_OBJECTS')
    expect(toolsSource).toContain("if (toolName === 'get_knowledge_objects') return getExactObjects")
    expect(manifestSource).toContain("'get_knowledge_objects'")
  })

  it('preserves and renders a structured canonical message-code index verbatim', () => {
    expect(toolsSource).toContain('[VERIFIED_ABAP_MESSAGE_CODES]')
    expect(toolsSource).toContain('extractAbapMessageCodes')
    expect(toolsSource).toContain('verifiedSignals: abapMessageCodes.length ? { abapMessageCodes } : undefined')
    expect(source).toContain('enumerate every code in that block without omission')
    expect(source).toContain('never compress a list to bare numbers')
    expect(source).toContain('answer code-only')
    expect(policySource).toContain('her canonical itemı final yanıtta birebir ve eksiksiz yaz')
    expect(policySource).toContain('prefix dahil tam canonical identifierı her item için koru')
    expect(source).toContain('never present a full-limit relation page as exhaustive')
  })

  it('keeps exact function signatures visible and forbids conventional parameter invention', () => {
    expect(source).toContain('For a function parameter or signature follow-up')
    expect(source).toContain('Preserve parameter identifiers exactly as verified')
    expect(source).toContain('compact batch record does not visibly contain those facts')
    expect(policySource).toContain('I_GPART` yerine alışılmış göründüğü için `IV_GPART')
    expect(policySource).toContain('IT_VERTRAG` yerine başka bir tablo adı')
    expect(policySource).toContain('ET_RESULT` yerine model hafızasından bir dönüş alanı yazma')
    expect(toolsSource).toContain('summary: truncateContent(record.summary, 1_200)')
    expect(toolsSource).toContain('evidenceExcerpt: truncateContent(record.content, 1_200)')
  })

  it('exposes authoritative paginated enumeration for all/hepsi catalog requests', () => {
    expect(manifestSource).toContain("'list_knowledge_catalog'")
    expect(toolsSource).toContain("name: 'list_knowledge_catalog'")
    expect(toolsSource).toContain("if (toolName === 'list_knowledge_catalog') return listCatalog")
    expect(toolsSource).toContain("output: verifiedToolOutput('list_knowledge_catalog'")
    expect(toolsSource).not.toContain("output: untrustedToolOutput('list_knowledge_catalog'")
    expect(source).toContain('authoritative paginated catalog enumeration for list/count/all/hepsi requests')
    expect(source).toContain('prefix="message:zcrm_cost"')
    expect(source).toContain('continue with nextCursor until it is null')
    expect(policySource).toContain('bounded search sonucunu "hepsi" sanma')
    expect(policySource).toContain('nextCursor null olana kadar sayfaları tamamla')
  })

  it('retries a precise search after candidate-verification closure instead of treating protocolBlocked as no-result', () => {
    expect(source).toContain('A protocolBlocked search is not a zero-result search and was not executed')
    expect(source).toContain('retry that blocked query before concluding the object/source is unavailable')
    expect(source).toContain('if the batch just discharged the candidate set that had caused a more precise current-goal search to be protocolBlocked')
    expect(policySource).toContain('`protocolBlocked=true` bir aramanın boş döndüğü anlamına gelmez')
    expect(policySource).toContain('o hassas queryyi yeniden değerlendir')
    expect(policySource).toContain('kullanıcıdan zaten elindeki identifierı tekrar isteme')
  })

  it('treats structural knowledge endpoints as identity/relation evidence, not hidden implementation source', () => {
    expect(source).toContain('Structural knowledge endpoint')
    expect(source).toContain('canonical identity and relation provenance only, not full implementation source')
    expect(source).toContain('tam implementasyon mevcut değil')
    expect(source).toContain('including its lowercase canonical path')
    expect(policySource).toContain('Structural knowledge endpoint / verified relation provenance')
    expect(policySource).toContain('lowercase canonical path dahil göster')
    expect(policySource).toContain('implementation source uydurma')
  })
})
