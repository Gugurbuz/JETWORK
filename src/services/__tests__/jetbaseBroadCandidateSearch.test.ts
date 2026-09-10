import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_KNOWLEDGE_TOOLS,
  executeAssistantTool,
} from '../../../supabase/functions/_shared/assistantTools.ts'

describe('Jetbase primary semantic candidate search', () => {
  it('does not expose an object-type filter on the primary semantic search tool', () => {
    const tool = ASSISTANT_KNOWLEDGE_TOOLS.find(candidate => candidate.name === 'search_knowledge_catalog')
    expect(tool).toBeTruthy()

    const serialized = JSON.stringify(tool)
    expect(serialized).toContain('across all catalog object types')
    expect(serialized).not.toContain('objectTypes')
  })

  it('searches all Jetbase object types even when a stale caller supplies a narrowed objectTypes argument', async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        return {
          data: [{
            scope_type: 'global',
            canonical_key: 'method:unscoped_class/check_lrtv3',
            object_type: 'method',
            object_name: 'CHECK_LRTV3',
            title: 'CHECK_LRTV3',
            summary: 'LRT-V3 ürün ailesi kontrolü',
            content: "METHOD check_lrtv3. CONSTANTS lc_lrtv3 VALUE 'LRT-V3'.",
            citation: null,
            chunk_index: null,
            score: 10.9,
            lexical_score: 1,
            vector_score: 0,
            source_id: 'source-lrt',
            source_name: 'CRM_Metot_Arsivi.txt',
          }],
          error: null,
        }
      },
    }

    const result = await executeAssistantTool(client, 'workspace-1', 'search_knowledge_catalog', {
      query: 'LRT',
      objectTypes: ['document', 'business_rule'],
      limit: 8,
    })

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('hybrid_search_knowledge_catalog_v2')
    expect(rpcCalls[0].args.p_object_types).toBeNull()
    expect(result.summary).toMatchObject({ resultCount: 1, objectTypes: null })
    expect(result.output).toContain('method:unscoped_class/check_lrtv3')
    expect(result.output).toContain('CHECK_LRTV3')
    expect(result.output).toContain('LRT-V3')
  })
})
