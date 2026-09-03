import { describe, expect, it } from 'vitest'
import { verifiedToolEvidenceForAnswerability } from '../../../supabase/functions/_shared/modelProvidersBase.ts'
import { sanitizeNovelCustomIdentifierClaims } from '../../../supabase/functions/_shared/providerAnswerabilityGuard.ts'

const call = (callId: string, name: string) => ({
  type: 'function_call',
  call_id: callId,
  name,
  arguments: '{}',
})

const output = (callId: string, payload: unknown) => ({
  type: 'function_call_output',
  call_id: callId,
  output: JSON.stringify(payload),
})

describe('Gemini V2 verified answerability boundary', () => {
  it('allows verified identifiers while removing unsupported technical identifiers', () => {
    const items: Array<Record<string, unknown>> = [
      call('r1', 'get_related_objects'),
      output('r1', {
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE. Factual relation rows are verified.',
        tool: 'get_related_objects',
        citationReady: true,
        records: {
          relations: [{ relationType: 'EMITS_MESSAGE', targetCanonicalKey: 'message:zcrm-114' }],
          objects: [{ canonicalKey: 'message:zcrm-114', objectType: 'message', title: 'ZCRM-114' }],
        },
      }),
    ]
    const context = `check_compare_itm_attr hangi mesajları üretir?\n${verifiedToolEvidenceForAnswerability(items)}`
    const sanitized = sanitizeNovelCustomIdentifierClaims(
      'ZCRM-114 doğrulanmış mesajdır. ZCL_FAKE_OWNER sınıfı bu metodu içerir.',
      context,
    )

    expect(sanitized.text).toContain('ZCRM-114')
    expect(sanitized.text).not.toContain('ZCL_FAKE_OWNER')
    expect(sanitized.removedIdentifiers).toContain('ZCL_FAKE_OWNER')
  })

  it('derives ZCRM_COST-111 as an allowed identifier from verified ABAP MESSAGE syntax', () => {
    const items: Array<Record<string, unknown>> = [
      call('a1', 'get_abap_source'),
      output('a1', {
        securityNotice: 'VERIFIED_KNOWLEDGE_EVIDENCE. Factual record fields are verified.',
        tool: 'get_abap_source',
        citationReady: true,
        records: [{
          canonicalKey: 'method:unscoped_class/ninja_calculate_oncrm',
          objectType: 'method',
          content: 'IF 1 = 2. MESSAGE e111(zcrm_cost). ENDIF.',
        }],
      }),
    ]
    const evidence = verifiedToolEvidenceForAnswerability(items)
    expect(evidence).toContain('ZCRM_COST-111')

    const sanitized = sanitizeNovelCustomIdentifierClaims(
      'ZCRM_COST-111 için ABAP satırı: MESSAGE e111(zcrm_cost).',
      `111 nolu hatanın abap kodunu ver\n${evidence}`,
    )
    expect(sanitized.text).toContain('ZCRM_COST-111')
    expect(sanitized.removedIdentifiers).toEqual([])
  })

  it('does not promote search candidates into the answerability allowlist', () => {
    const items: Array<Record<string, unknown>> = [
      call('s1', 'search_knowledge_catalog'),
      output('s1', {
        securityNotice: 'UNTRUSTED_KNOWLEDGE_DATA. Search records are candidate evidence only.',
        tool: 'search_knowledge_catalog',
        records: [{ canonicalKey: 'message:zcrm-999' }],
      }),
    ]
    expect(verifiedToolEvidenceForAnswerability(items)).toBe('')
  })
})
