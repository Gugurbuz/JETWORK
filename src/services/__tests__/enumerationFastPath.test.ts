import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEnumerationFastPathDispatch,
  buildOpenAiEnumerationFastPathMarkerItem,
} from '../../../supabase/functions/_shared/enumerationFastPath';
import { createOpenAiCircuitBreaker } from '../../../supabase/functions/_shared/providerCircuitBreaker';
import { executeClassInventoryTool } from '../../../supabase/functions/_shared/classInventoryTool';

const semanticItems = (enumerationTarget: Record<string, unknown>) => [{
  role: 'user',
  content: [
    'listele',
    '[JETWORK_SEMANTIC_PLAN]',
    JSON.stringify({
      intent: 'analysis',
      complexity: 'low',
      knowledgeRequired: true,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      evidenceQueries: [],
      steps: [],
      enumerationTarget,
    }),
    '[END_JETWORK_SEMANTIC_PLAN]',
  ].join('\n'),
}];

describe('deterministic enumeration dispatch fast path', () => {
  it('dispatches broad class inventory directly from the authoritative semantic target', () => {
    const dispatch = buildEnumerationFastPathDispatch(semanticItems({
      tool: 'list_class_inventory',
      objectType: 'class',
      prefix: null,
      cursor: null,
    }));
    expect(dispatch).toEqual({ toolName: 'list_class_inventory', arguments: {} });
  });

  it('follows list_knowledge_catalog pagination without asking a model to choose the next tool call', () => {
    const items: Array<Record<string, unknown>> = [
      ...semanticItems({ tool: 'list_knowledge_catalog', objectType: 'message', prefix: 'ZCRMCOST', cursor: null }),
      {
        type: 'function_call',
        name: 'list_knowledge_catalog',
        call_id: 'page-1',
        arguments: JSON.stringify({ objectType: 'message', prefix: 'ZCRMCOST', cursor: null, limit: 25 }),
      },
      {
        type: 'function_call_output',
        call_id: 'page-1',
        output: JSON.stringify({
          tool: 'list_knowledge_catalog',
          records: { items: [{ canonicalKey: 'message:zcrm_cost-000' }], totalCount: 62, nextCursor: 'message:zcrm_cost-087' },
        }),
      },
    ];

    expect(buildEnumerationFastPathDispatch(items)).toEqual({
      toolName: 'list_knowledge_catalog',
      arguments: {
        objectType: 'message',
        prefix: 'ZCRMCOST',
        cursor: 'message:zcrm_cost-087',
        limit: 25,
      },
    });
  });

  it('stops dispatching after pagination is complete', () => {
    const items: Array<Record<string, unknown>> = [
      ...semanticItems({ tool: 'list_knowledge_catalog', objectType: 'message', prefix: 'ZCRMCOST', cursor: null }),
      {
        type: 'function_call',
        name: 'list_knowledge_catalog',
        call_id: 'page-final',
        arguments: JSON.stringify({ objectType: 'message', prefix: 'ZCRMCOST', cursor: 'message:zcrm_cost-154', limit: 25 }),
      },
      {
        type: 'function_call_output',
        call_id: 'page-final',
        output: JSON.stringify({
          tool: 'list_knowledge_catalog',
          records: { items: [{ canonicalKey: 'message:zcrm_cost-165' }], totalCount: 62, nextCursor: null },
        }),
      },
    ];
    expect(buildEnumerationFastPathDispatch(items)).toBeNull();
  });

  it('starts a resumed turn from the structured enumeration cursor', () => {
    const dispatch = buildEnumerationFastPathDispatch(semanticItems({
      tool: 'list_knowledge_catalog',
      objectType: 'message',
      prefix: null,
      cursor: 'message:zcrm_price_key-045',
    }));
    expect(dispatch).toEqual({
      toolName: 'list_knowledge_catalog',
      arguments: {
        objectType: 'message',
        prefix: null,
        cursor: 'message:zcrm_price_key-045',
        limit: 25,
      },
    });
  });

  it('wires the Gemini fast path before the real provider call', () => {
    const providers = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
      'utf8',
    );
    expect(providers).toContain('buildEnumerationFastPathDispatch(input.items)');
    expect(providers).toContain('buildSyntheticEnumerationFunctionCall(enumerationDispatch)');
    expect(providers).toContain('deterministic_provider_calls_avoided: 1');
    const dispatchIndex = providers.indexOf('buildEnumerationFastPathDispatch(input.items)');
    const realProviderIndex = providers.indexOf('legacyRequestGeminiResponse({', dispatchIndex);
    expect(dispatchIndex).toBeGreaterThan(-1);
    expect(realProviderIndex).toBeGreaterThan(dispatchIndex);
  });

  it('wires the OpenAI marker from the shared provider sanitizer', () => {
    const providers = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
      'utf8',
    );
    expect(providers).toContain('buildOpenAiEnumerationFastPathMarkerItem(enumerationDispatch)');
    expect(providers).toContain('const enumerationDispatch = buildEnumerationFastPathDispatch(items)');
  });

  it('avoids the OpenAI provider call through the installed fetch circuit layer', async () => {
    const marker = buildOpenAiEnumerationFastPathMarkerItem({
      toolName: 'list_class_inventory',
      arguments: {},
    });
    const baseFetch = vi.fn(async () => {
      throw new Error('provider fetch should not run');
    }) as unknown as typeof fetch;
    const breaker = createOpenAiCircuitBreaker(baseFetch);
    const response = await breaker.fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5.6-sol', input: [marker], stream: true }),
    });
    const body = await response.text();

    expect(response.ok).toBe(true);
    expect(body).toContain('list_class_inventory');
    expect(body).toContain('deterministic_provider_calls_avoided');
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('keeps the OpenAI marker contract round-trippable', () => {
    expect(buildOpenAiEnumerationFastPathMarkerItem({
      toolName: 'list_class_inventory',
      arguments: {},
    }).content).toContain('[JETWORK_ENUMERATION_FAST_PATH]');
  });
});

describe('class inventory source badge semantics', () => {
  it('returns one source document for multiple class records parsed from the same inventory file', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: [{
          scope_type: 'global',
          source_id: 'source-1',
          source_name: 'CRM_Class_Envanteri.md',
          raw_text: [
            '| Sınıf | `ZCL_ONE` |',
            '# ZCL_ONE',
            '| Açıklama | Birinci class |',
            'İlişkili yardımcı sınıf ZCL_TWO üzerinden yürür.',
          ].join('\n'),
        }],
        error: null,
      })),
    };

    const result = await executeClassInventoryTool(client, 'workspace-1', {});
    expect(result.summary.totalCount).toBe(2);
    expect(result.summary.sourceDocumentCount).toBe(1);
    expect(result.sources).toEqual([{
      sourceId: 'source-1',
      sourceName: 'CRM_Class_Envanteri.md',
      title: 'CRM_Class_Envanteri.md',
    }]);
  });
});
