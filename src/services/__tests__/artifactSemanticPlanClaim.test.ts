import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('artifact semantic plan claim', () => {
  it('treats an existing artifact task as authoritative document intent without regex inference', () => {
    const source = readFileSync(
      new URL('../../../supabase/migrations/20260810043000_route_active_artifact_tasks_as_documents.sql', import.meta.url),
      'utf8',
    );

    expect(source).toContain('from public.artifact_tasks artifact_row');
    expect(source).toContain('artifact_row.request_message_id = safe_message_id');
    expect(source).toContain("'intent', 'document'");
    expect(source).toContain("'executionMode', 'artifact'");
    expect(source).toContain("'knowledgeRequired', false");
    expect(source).toContain('do not reinterpret the request as a technical diagnosis');
    expect(source).not.toContain('regexp');
  });
});
