import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const surfaceSource = readFileSync('supabase/functions/_shared/capabilities/controllerSurface.ts', 'utf8')
const policySource = readFileSync('supabase/functions/_shared/agent/controllerPolicy.ts', 'utf8')
const toolsSource = readFileSync('supabase/functions/_shared/assistantTools.ts', 'utf8')
const manifestSource = readFileSync('supabase/functions/_shared/capabilityManifest.ts', 'utf8')

describe('Agent Controller V3 knowledge execution boundary', () => {
  it('contains no hidden candidate-verification protocol or blocked-search state machine', () => {
    expect(toolsSource).not.toContain('pendingSearchVerificationByClient')
    expect(toolsSource).not.toContain('SEARCH_CANDIDATES_REQUIRE_EXACT_VERIFICATION')
    expect(toolsSource).not.toContain('protocolBlocked')
    expect(toolsSource).not.toContain('markPendingSearchVerified')
    expect(toolsSource).not.toContain('setPendingSearchVerification')
    expect(surfaceSource).not.toContain('CONTROLLER_TOOL_GUIDANCE')
    expect(policySource).not.toContain('Candidate-verification closure uygula')
  })

  it('executes the controller-authored knowledge query without runtime semantic expansion', () => {
    expect(toolsSource).toContain('export const expandKnowledgeSearchQueries = (query: string)')
    expect(toolsSource).toContain('return exact ? [exact] : []')
    expect(toolsSource).not.toContain("add('customer_type_id')")
    expect(toolsSource).not.toContain("add('zzcust_type_id')")
    expect(toolsSource).not.toContain("add('partner')")
    expect(toolsSource).not.toContain("add('ninja')")
    expect(toolsSource).toContain("p_query: exactQuery")
    expect(toolsSource).toContain('queriesExecuted: searchQueries')
  })

  it('keeps exact, batch, relation and enumeration capabilities available without prescribing their order', () => {
    expect(manifestSource).toContain("'get_knowledge_objects'")
    expect(manifestSource).toContain("'list_knowledge_catalog'")
    expect(toolsSource).toContain("name: 'get_knowledge_object'")
    expect(toolsSource).toContain("name: 'get_knowledge_objects'")
    expect(toolsSource).toContain("name: 'get_related_objects'")
    expect(toolsSource).toContain("name: 'list_knowledge_catalog'")
    expect(toolsSource).toContain('maxItems: MAX_BATCH_EXACT_OBJECTS')
    expect(toolsSource).toContain("if (toolName === 'get_knowledge_objects') return getExactObjects")
    expect(toolsSource).toContain("if (toolName === 'list_knowledge_catalog') return listCatalog")
    expect(surfaceSource).not.toContain('next knowledge call MUST')
    expect(policySource).toContain('exact/detail/relation/list/search seçimlerine')
  })

  it('preserves mechanical verified-evidence and ABAP message-code extraction', () => {
    expect(toolsSource).toContain('VERIFIED_KNOWLEDGE_EVIDENCE')
    expect(toolsSource).toContain('[VERIFIED_ABAP_MESSAGE_CODES]')
    expect(toolsSource).toContain('extractAbapMessageCodes')
    expect(toolsSource).toContain('verifiedSignals: abapMessageCodes.length ? { abapMessageCodes } : undefined')
    expect(toolsSource).toContain('citationReady: true')
    expect(policySource).toContain('Kuruma özgü veya exact teknik bir iddiayı yalnız elindeki observation gerçekten destekliyorsa kesinleştir')
  })

  it('keeps pagination metadata factual while leaving pagination decisions to the model', () => {
    expect(toolsSource).toContain('const nextCursor = cleanString(payload.nextCursor, 320) || null')
    expect(toolsSource).toContain('output: verifiedToolOutput(\'list_knowledge_catalog\', { items, totalCount, nextCursor })')
    expect(toolsSource).toContain('enumeration: true')
    expect(toolsSource).not.toContain('continue with nextCursor until it is null')
    expect(policySource).not.toContain('nextCursor null olana kadar sayfaları tamamla')
  })

  it('treats candidate status as evidence metadata, not a next-tool instruction', () => {
    expect(toolsSource).toContain('Candidate status is evidence metadata, not a runtime instruction about what tool must be called next')
    expect(surfaceSource).toContain('retrieval strategy')
    expect(surfaceSource).toContain('controller model')
  })
})
