import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260810070500_normalize_knowledge_enumeration_prefix.sql', import.meta.url),
  'utf8',
);

const normalizeTechnicalIdentifier = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

describe('knowledge enumeration prefix normalization', () => {
  it('treats common technical separator variants as the same prefix', () => {
    const expected = 'zcrmcost';
    expect(normalizeTechnicalIdentifier('ZCRMCOST')).toBe(expected);
    expect(normalizeTechnicalIdentifier('ZCRM_COST')).toBe(expected);
    expect(normalizeTechnicalIdentifier('zcrm-cost')).toBe(expected);
    expect(normalizeTechnicalIdentifier('zcrm cost')).toBe(expected);
  });

  it('normalizes both published names and canonical-key suffixes inside the enumeration RPC', () => {
    expect(migrationSource).toContain("regexp_replace(lower(coalesce(trim(p_prefix), '')), '[^a-z0-9]+', '', 'g')");
    expect(migrationSource).toContain("regexp_replace(lower(coalesce(o.published_name, '')), '[^a-z0-9]+', '', 'g')");
    expect(migrationSource).toContain("regexp_replace(lower(split_part(o.canonical_key, ':', 2)), '[^a-z0-9]+', '', 'g')");
    expect(migrationSource).toContain("like f.normalized_prefix || '%'");
  });

  it('keeps the bounded pagination and authenticated-only execution contract intact', () => {
    expect(migrationSource).toContain('least(coalesce(p_limit, 25), 25)');
    expect(migrationSource).toContain("'totalCount'");
    expect(migrationSource).toContain("'nextCursor'");
    expect(migrationSource).toContain('revoke execute on function public.list_knowledge_catalog_v2');
    expect(migrationSource).toContain('from anon');
    expect(migrationSource).toContain('to authenticated');
  });
});
