import { describe, expect, it } from 'vitest';
import { buildDeterministicEnumerationFinalization } from '../../../supabase/functions/_shared/enumerationFinalizer';

const page = (start: number, count: number, totalCount: number, nextCursor: string | null) => JSON.stringify({
  tool: 'list_knowledge_catalog',
  records: {
    items: Array.from({ length: count }, (_, offset) => {
      const code = String(start + offset).padStart(3, '0');
      return {
        canonicalKey: `message:zcrm_cost-${code}`,
        objectType: 'message',
        name: `ZCRM_COST-${code}`,
        title: `ZCRM_COST-${code} — Hata açıklaması ${code}`,
        summary: `Özet ${code}`,
        sourceName: 'CRM_Hata_Bilgi_Bankasi.md',
      };
    }),
    totalCount,
    nextCursor,
  },
});

const call = (id: string, cursor: string | null) => ({
  type: 'function_call',
  call_id: id,
  name: 'list_knowledge_catalog',
  arguments: JSON.stringify({ objectType: 'message', prefix: 'ZCRMCOST', cursor, limit: 25 }),
});

const output = (id: string, value: string) => ({ type: 'function_call_output', call_id: id, output: value });

describe('deterministic enumeration finalizer', () => {
  it('finalizes a complete 25+25+12 enumeration without asking an LLM to reinterpret it', () => {
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'zcrmcost hatalarının tümünü listele' },
      call('p1', null), output('p1', page(0, 25, 62, 'message:zcrm_cost-024')),
      call('p2', 'message:zcrm_cost-024'), output('p2', page(25, 25, 62, 'message:zcrm_cost-049')),
      call('p3', 'message:zcrm_cost-049'), output('p3', page(50, 12, 62, null)),
    ];

    const result = buildDeterministicEnumerationFinalization(items);
    expect(result).toMatchObject({ totalCount: 62, collectedCount: 62, pageCount: 3, complete: true, nextCursor: null });
    expect(result!.text).toContain('eşleşen **62 kayıt** bulundu');
    expect(result!.text).toContain('**ZCRM_COST-000:** Hata açıklaması 000');
    expect(result!.text).toContain('**ZCRM_COST-061:** Hata açıklaması 061');
    expect(result!.text).not.toMatch(/kayıt bulunamadı/i);
    expect(result!.text).not.toContain('Lütfen aşağıdaki soruları');
  });

  it('returns a deterministic partial list only after multiple pages when the runtime explicitly allows partial finalization', () => {
    const items: Array<Record<string, unknown>> = [
      call('p1', null), output('p1', page(0, 25, 62, 'message:zcrm_cost-024')),
      call('p2', 'message:zcrm_cost-024'), output('p2', page(25, 25, 62, 'message:zcrm_cost-049')),
    ];

    expect(buildDeterministicEnumerationFinalization(items)).toBeNull();
    const result = buildDeterministicEnumerationFinalization(items, { allowPartial: true });
    expect(result).toMatchObject({ totalCount: 62, collectedCount: 50, pageCount: 2, complete: false });
    expect(result!.text).toContain('**50 kayıt** getirilebildi');
    expect(result!.text).toContain('liste kısmi');
  });

  it('does not hijack a single partial page, leaving count/discovery requests to normal synthesis', () => {
    const items: Array<Record<string, unknown>> = [
      call('p1', null), output('p1', page(0, 25, 62, 'message:zcrm_cost-024')),
    ];
    expect(buildDeterministicEnumerationFinalization(items, { allowPartial: true })).toBeNull();
  });

  it('deduplicates records by canonical key before deciding completeness', () => {
    const duplicatePage = JSON.stringify({
      tool: 'list_knowledge_catalog',
      records: {
        items: [
          { canonicalKey: 'message:zcrm_cost-000', name: 'ZCRM_COST-000', title: 'ZCRM_COST-000 — A' },
          { canonicalKey: 'message:zcrm_cost-000', name: 'ZCRM_COST-000', title: 'ZCRM_COST-000 — A duplicate' },
        ],
        totalCount: 2,
        nextCursor: null,
      },
    });
    const items: Array<Record<string, unknown>> = [call('p1', null), output('p1', duplicatePage)];
    expect(buildDeterministicEnumerationFinalization(items)).toBeNull();
  });

  it('keeps different enumeration filters isolated', () => {
    const otherCall = {
      type: 'function_call', call_id: 'other', name: 'list_knowledge_catalog',
      arguments: JSON.stringify({ objectType: 'table', prefix: 'EVER', cursor: null, limit: 25 }),
    };
    const otherOutput = JSON.stringify({
      tool: 'list_knowledge_catalog',
      records: { items: [{ canonicalKey: 'table:ever', objectType: 'table', name: 'EVER', title: 'EVER' }], totalCount: 1, nextCursor: null },
    });
    const items: Array<Record<string, unknown>> = [
      call('p1', null), output('p1', page(0, 25, 62, 'message:zcrm_cost-024')),
      otherCall, output('other', otherOutput),
    ];
    const result = buildDeterministicEnumerationFinalization(items);
    expect(result).toMatchObject({ totalCount: 1, collectedCount: 1, complete: true });
    expect(result!.text).toContain('**EVER:** EVER');
  });
});
