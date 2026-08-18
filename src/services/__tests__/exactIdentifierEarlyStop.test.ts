import { describe, expect, it } from 'vitest';
import {
  findEmptyExactIdentifierPair,
  findEmptyMessageDetailNeedingCatalogCheck,
  hasEmptyMessageDetailLookup,
} from '../../../supabase/functions/_shared/exactIdentifierEarlyStop';

const functionCall = (callId: string, name: string, args: Record<string, unknown>) => ({
  type: 'function_call',
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
});

const emptyOutput = (callId: string) => ({
  type: 'function_call_output',
  call_id: callId,
  output: JSON.stringify({ records: [] }),
});

const populatedOutput = (callId: string) => ({
  type: 'function_call_output',
  call_id: callId,
  output: JSON.stringify({ records: [{ canonicalKey: 'message:zcrm2-545' }] }),
});

describe('exact identifier early stop', () => {
  it('detects an empty exact message lookup followed by the same empty catalog query', () => {
    const items = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      emptyOutput('detail'),
      functionCall('search', 'search_knowledge_catalog', { query: 'zcrm2-545' }),
      emptyOutput('search'),
    ];

    expect(hasEmptyMessageDetailLookup(items)).toBe(true);
    expect(findEmptyMessageDetailNeedingCatalogCheck(items)).toBeNull();
    expect(findEmptyExactIdentifierPair(items)).toEqual({
      identifier: 'ZCRM2-545',
      lookupTool: 'get_message_detail',
    });
  });

  it('requests a deterministic exact catalog check after an empty detail lookup', () => {
    const items = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      emptyOutput('detail'),
    ];

    expect(findEmptyMessageDetailNeedingCatalogCheck(items)).toEqual({
      identifier: 'ZCRM2-545',
      lookupTool: 'get_message_detail',
    });
  });

  it('does not request another exact catalog check after the exact query was already attempted', () => {
    const items = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      emptyOutput('detail'),
      functionCall('search', 'search_knowledge_catalog', { query: 'ZCRM2-545' }),
    ];

    expect(findEmptyMessageDetailNeedingCatalogCheck(items)).toBeNull();
  });

  it('does not stop when the catalog query is broader than the exact identifier', () => {
    const items = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      emptyOutput('detail'),
      functionCall('search', 'search_knowledge_catalog', { query: 'ZCRM2-545 aktarım hatası' }),
      emptyOutput('search'),
    ];

    expect(findEmptyMessageDetailNeedingCatalogCheck(items)).toEqual({
      identifier: 'ZCRM2-545',
      lookupTool: 'get_message_detail',
    });
    expect(findEmptyExactIdentifierPair(items)).toBeNull();
  });

  it('does not stop when either lookup contains evidence', () => {
    const detailFound = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      populatedOutput('detail'),
      functionCall('search', 'search_knowledge_catalog', { query: 'ZCRM2-545' }),
      emptyOutput('search'),
    ];
    const searchFound = [
      functionCall('detail', 'get_message_detail', { messageCode: 'ZCRM2-545' }),
      emptyOutput('detail'),
      functionCall('search', 'search_knowledge_catalog', { query: 'ZCRM2-545' }),
      populatedOutput('search'),
    ];

    expect(findEmptyExactIdentifierPair(detailFound)).toBeNull();
    expect(findEmptyExactIdentifierPair(searchFound)).toBeNull();
  });
});
