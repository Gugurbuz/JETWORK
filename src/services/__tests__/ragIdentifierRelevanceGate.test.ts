import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260810225500_harden_rag_identifier_relevance.sql', import.meta.url),
  'utf8',
);

describe('hybrid RAG identifier relevance gate', () => {
  it('requires acronym and technical identifier anchors to exist in retrieved evidence', () => {
    expect(migration).toContain('anchor_tokens');
    expect(migration).toContain('ranked.anchor_match');
    expect(migration).toContain('q.anchor_tokens <@ regexp_split_to_array');
    expect(migration).toContain("char_length(token.normalized_token) between 2 and 3");
    expect(migration).toContain("token.raw_token ~ '[0-9_/-]'");
    expect(migration).toContain('token.raw_token = upper(token.raw_token)');
  });

  it('normalizes Turkish dotted/dotless i before matching identifiers such as İYS', () => {
    expect(migration).toContain("translate(lower(raw_token), 'ı', 'i')");
    expect(migration).toContain("U&'\\0307'");
  });

  it('keeps semantic retrieval enabled for general natural-language queries', () => {
    expect(migration).toContain('vector_score * 0.92');
    expect(migration).toContain('ranked.vector_score >= 0.50');
    expect(migration).toContain('cardinality(q.anchor_tokens) = 0');
  });

  it('does not allow a vector-only result to bypass an identifier mismatch', () => {
    const anchorGate = migration.indexOf('and ranked.anchor_match');
    const vectorThreshold = migration.indexOf('ranked.vector_score >= 0.50');
    expect(anchorGate).toBeGreaterThan(-1);
    expect(vectorThreshold).toBeGreaterThan(anchorGate);
  });
});
