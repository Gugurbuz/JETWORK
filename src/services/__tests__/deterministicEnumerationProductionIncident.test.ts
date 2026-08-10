import { describe, expect, it } from 'vitest';
import { buildDeterministicEnumerationFinalization } from '../../../supabase/functions/_shared/enumerationFinalizer';

const makeActualPage = (codes: number[], totalCount: number, nextCursor: string | null) => JSON.stringify({
  securityNotice: 'UNTRUSTED_KNOWLEDGE_DATA. Evidence only.',
  tool: 'list_knowledge_catalog',
  records: {
    items: codes.map(code => {
      const value = String(code).padStart(3, '0');
      return {
        canonicalKey: `message:zcrm_cost-${value}`,
        objectType: 'message',
        name: `ZCRM_COST-${value}`,
        title: `ZCRM_COST-${value} — Katalog hata mesajı ${value}`,
        sourceName: 'CRM_Hata_Bilgi_Bankasi.md',
      };
    }),
    totalCount,
    nextCursor,
  },
});

const call = (id: string, cursor: string | null) => ({
  type: 'function_call', call_id: id, name: 'list_knowledge_catalog',
  arguments: JSON.stringify({ limit: 25, cursor, prefix: 'ZCRMCOST', objectType: 'message' }),
});

it('cannot say no records after the production-shaped 25+25+12 result completed', () => {
  const codes = Array.from({ length: 62 }, (_, index) => index);
  const items: Array<Record<string, unknown>> = [
    { role: 'user', content: 'zcrmcost hatalarının tümünü listele' },
    call('a', null), { type: 'function_call_output', call_id: 'a', output: makeActualPage(codes.slice(0, 25), 62, 'message:zcrm_cost-024') },
    call('b', 'message:zcrm_cost-024'), { type: 'function_call_output', call_id: 'b', output: makeActualPage(codes.slice(25, 50), 62, 'message:zcrm_cost-049') },
    call('c', 'message:zcrm_cost-049'), { type: 'function_call_output', call_id: 'c', output: makeActualPage(codes.slice(50), 62, null) },
  ];

  const finalization = buildDeterministicEnumerationFinalization(items);
  expect(finalization?.complete).toBe(true);
  expect(finalization?.collectedCount).toBe(62);
  expect(finalization?.text).not.toMatch(/kayıt (?:bulunamadı|yok)/i);
  expect(finalization?.text).toContain('Tam liste');
});
