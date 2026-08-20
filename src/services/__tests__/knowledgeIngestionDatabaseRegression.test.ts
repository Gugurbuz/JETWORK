import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const originalMigration = readFileSync(
  new URL('../../../supabase/migrations/20260810183000_knowledge_hybrid_rag_engine.sql', import.meta.url),
  'utf8',
);
const ambiguityFixMigration = readFileSync(
  new URL('../../../supabase/migrations/20260820092250_fix_knowledge_ingest_object_version_ambiguity.sql', import.meta.url),
  'utf8',
);
const edgeFunction = readFileSync(
  new URL('../../../supabase/functions/ingest-knowledge-source/index.ts', import.meta.url),
  'utf8',
);

const functionPattern = /create or replace function public\.ingest_knowledge_catalog_v2\([\s\S]*?\n\$\$;/;

describe('knowledge catalog ingestion database regression', () => {
  it('renames only the colliding PL/pgSQL variable in the replacement function', () => {
    const originalDefinition = originalMigration.match(functionPattern)?.[0];
    const fixedDefinition = ambiguityFixMigration.match(functionPattern)?.[0];

    expect(originalDefinition).toBeTruthy();
    expect(fixedDefinition).toBeTruthy();
    expect(fixedDefinition?.replaceAll('v_object_version_id', 'object_version_id'))
      .toBe(originalDefinition);
    expect(fixedDefinition).toContain('v_object_version_id uuid;');
    expect(fixedDefinition).not.toMatch(/\n\s*object_version_id uuid;/);
  });

  it('keeps database column and conflict-target names unchanged', () => {
    expect(ambiguityFixMigration).toContain(
      'knowledge_space_id,source_version_id,object_version_id,chunk_index,content,embedding,metadata',
    );
    expect(ambiguityFixMigration).toContain(
      'on conflict (object_version_id, chunk_index) do update',
    );
    expect(ambiguityFixMigration).toContain(
      'do update set object_version_id=excluded.object_version_id;',
    );
  });

  it('retains message details from plain Supabase/PostgREST error objects', () => {
    expect(edgeFunction).toContain("typeof error === 'object' && 'message' in error");
    expect(edgeFunction).toContain('const message = ingestionErrorMessage(error)');
  });
});
