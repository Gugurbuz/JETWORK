import { describe, expect, it } from 'vitest'
import {
  RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME,
  executeRetrieveJetbaseEvidence,
} from '../../../supabase/functions/_shared/jetbaseEvidenceTool.ts'
import {
  buildControllerCapabilitySurface,
  buildExecuteCapabilitiesTool,
  parseAndValidateCapabilityInvocation,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'

describe('high-level Jetbase evidence retrieval', () => {
  it('is a canonical model-selectable capability while the physical provider surface stays compact', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.logicalToolNames).toContain(RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME)
    expect(surface.toolNames).not.toContain(RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME)

    const gateway = buildExecuteCapabilitiesTool()
    expect(gateway.description).toContain('default high-level retrieval')
    expect(gateway.description).toContain('Do not manually reproduce search → exact → relation → source')

    const invocation = parseAndValidateCapabilityInvocation(
      RETRIEVE_JETBASE_EVIDENCE_TOOL_NAME,
      JSON.stringify({
        query: 'CHECK_ZTKS hangi mesajları üretiyor?',
        evidenceKinds: ['exact', 'relations'],
        focusIdentifiers: ['CHECK_ZTKS'],
        relationTypes: ['EMITS_MESSAGE'],
        relationDirection: 'both',
        candidateWindowSize: 4,
        sourceWindowSize: 2,
      }),
    )
    expect(invocation.ok).toBe(true)
  })

  it('returns candidate + exact + relation + focused source in one execution', async () => {
    const rpcCalls: string[] = []
    const methodRow = {
      scope_type: 'global',
      canonical_key: 'method:zcl_demo/check_demo',
      object_type: 'method',
      object_name: 'CHECK_DEMO',
      title: 'CHECK_DEMO',
      summary: 'Demo kontrolü',
      content: [
        'METHOD check_demo.',
        '  IF iv_test = abap_true.',
        '    MESSAGE e111(zcrm_cost).',
        '  ENDIF.',
        'ENDMETHOD.',
      ].join('\n'),
      source_name: 'CRM source',
      source_id: 'source-method',
      version_number: 1,
    }
    const messageRow = {
      scope_type: 'global',
      canonical_key: 'message:zcrm_cost-111',
      object_type: 'message',
      object_name: 'ZCRM_COST-111',
      title: 'ZCRM_COST-111',
      summary: 'Demo mesajı',
      content: 'ZCRM_COST-111 demo message',
      source_name: 'CRM messages',
      source_id: 'source-message',
      version_number: 1,
    }
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push(name)
        if (name === 'get_knowledge_object_v2') {
          return {
            data: String(args.p_canonical_key) === 'message:zcrm_cost-111' ? messageRow : methodRow,
            error: null,
          }
        }
        if (name === 'get_related_knowledge_objects_v2') {
          return {
            data: [{
              relation_id: 'rel-1',
              source_canonical_key: methodRow.canonical_key,
              relation_type: 'EMITS_MESSAGE',
              target_canonical_key: messageRow.canonical_key,
              evidence: 'MESSAGE e111(zcrm_cost)',
              related_canonical_key: messageRow.canonical_key,
              related_object_type: 'message',
              related_name: messageRow.object_name,
              related_title: messageRow.title,
              related_summary: messageRow.summary,
              source_id: messageRow.source_id,
              source_name: messageRow.source_name,
              scope_type: 'global',
            }],
            error: null,
          }
        }
        throw new Error('Unexpected RPC: ' + name)
      },
    }

    const result = await executeRetrieveJetbaseEvidence({
      client,
      workspaceId: 'workspace-1',
      args: {
        query: 'CHECK_DEMO ZCRM_COST-111 ABAP',
        evidenceKinds: ['exact', 'relations', 'source'],
        focusIdentifiers: ['CHECK_DEMO', 'ZCRM_COST-111'],
        relationTypes: ['EMITS_MESSAGE'],
        relationDirection: 'both',
        candidateWindowSize: 4,
        sourceWindowSize: 2,
      },
      search: async () => ({
        output: JSON.stringify({
          securityNotice: 'UNTRUSTED_KNOWLEDGE_DATA',
          records: [{
            canonicalKey: methodRow.canonical_key,
            objectType: 'method',
            objectName: 'CHECK_DEMO',
            title: 'CHECK_DEMO',
            summary: 'Demo kontrolü',
            evidenceExcerpt: 'MESSAGE e111(zcrm_cost)',
            score: 0.99,
            lexicalScore: 1,
            vectorScore: 0.8,
            sourceName: 'CRM source',
          }],
        }),
        sources: [],
        summary: { citationReady: false, semanticVectorEnabled: true },
      }),
    })

    const payload = JSON.parse(result.output)
    expect(payload.citationReady).toBe(true)
    expect(payload.records.candidates).toHaveLength(1)
    expect(payload.records.exact.some((record: { canonicalKey?: string }) => record.canonicalKey === methodRow.canonical_key)).toBe(true)
    expect(payload.records.relations[0].relationType).toBe('EMITS_MESSAGE')
    expect(payload.records.relatedExact.some((record: { canonicalKey?: string }) => record.canonicalKey === messageRow.canonical_key)).toBe(true)
    expect(payload.records.source[0].content).toContain('MESSAGE e111(zcrm_cost)')
    expect(result.summary.retrievalEngine).toBe('jetbase-evidence-pack-v1')
    expect(rpcCalls).toContain('get_related_knowledge_objects_v2')
    expect(rpcCalls.filter(name => name === 'get_knowledge_object_v2').length).toBeGreaterThanOrEqual(2)
  })

  it('contains no benchmark-specific semantic routing', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('../../../supabase/functions/_shared/jetbaseEvidenceTool.ts', import.meta.url), 'utf8'),
    )
    expect(source).not.toContain("query === '111'")
    expect(source).not.toContain("query.includes('CHECK_ZTKS')")
    expect(source).not.toContain('GET_SATILABILIR_LIMIT')
  })
})
