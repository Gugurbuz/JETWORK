import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createJetWorkPresentationDeltaBoundary,
  extractJetWorkPresentationMetadata,
  stripJetWorkPresentationMetadata,
} from '../../../supabase/functions/_shared/presentationMetadataBoundaryQuality';

const coreSource = readFileSync(
  new URL('../../../supabase/functions/_shared/corePreflightServerQuality.ts', import.meta.url),
  'utf8',
);

describe('server assistant presentation metadata boundary', () => {
  it('removes complete private metadata blocks from persisted/user-facing text', () => {
    const raw = 'Yanıt burada.\n\n<jetwork_meta>\n{"workSummary":[],"questions":[],"actionSummary":""}\n</jetwork_meta>';
    const extracted = extractJetWorkPresentationMetadata(raw);

    expect(extracted.visibleText).toBe('Yanıt burada.');
    expect(extracted.strippedBlocks).toBe(1);
    expect(extracted.metadata).toEqual([{ workSummary: [], questions: [], actionSummary: '' }]);
    expect(stripJetWorkPresentationMetadata(raw)).toBe('Yanıt burada.');
  });

  it('hides an incomplete private block instead of leaking it during streaming', () => {
    expect(stripJetWorkPresentationMetadata('Yanıt\n<jetwork_meta>{"workSummary":[')).toBe('Yanıt');
  });

  it('filters a metadata tag even when the opening and closing tags are split across deltas', () => {
    const boundary = createJetWorkPresentationDeltaBoundary();
    const chunks = [
      'İlk cevap.\n<jet',
      'work_meta>{"workSummary":["x"],',
      '"questions":[],"actionSummary":"y"}</jetwork_',
      'meta> Son cümle.',
    ];

    const visible = chunks.map(chunk => boundary.push(chunk).delta).join('') + boundary.finish().delta;
    expect(visible).toBe('İlk cevap.\n Son cümle.');
    expect(boundary.strippedCount()).toBe(1);
    expect(visible).not.toContain('jetwork_meta');
    expect(visible).not.toContain('workSummary');
  });

  it('does not buffer or rewrite ordinary prose that contains angle brackets', () => {
    const boundary = createJetWorkPresentationDeltaBoundary();
    const visible = boundary.push('A < B ve C > D').delta + boundary.finish().delta;
    expect(visible).toBe('A < B ve C > D');
    expect(boundary.strippedCount()).toBe(0);
  });

  it('temporarily preserves legacy artifact metadata needed by the current document client', () => {
    const boundary = createJetWorkPresentationDeltaBoundary();
    const raw = 'İhtiyaç Analizi Dokümanı\n1. Analiz Kapsamı\n<jetwork_meta>{"questions":[{"id":"q1","text":"Alan adı?"}],"actionSummary":"Dokümanı tamamla"}</jetwork_meta>';
    const visible = boundary.push(raw).delta + boundary.finish().delta;

    expect(visible).toContain('<jetwork_meta>');
    expect(visible).toContain('Alan adı?');
    expect(boundary.strippedCount()).toBe(0);
  });

  it('wires the boundary into both SSE output and assistant_turn persistence/cache paths', () => {
    expect(coreSource).toContain('sanitizeAssistantSseResponse');
    expect(coreSource).toContain("/\\/rest\\/v1\\/rpc\\/complete_assistant_turn$/u");
    expect(coreSource).toContain('sanitizeCompletionRequest(init)');
    expect(coreSource).toContain('stripJetWorkPresentationMetadata(row.response_text)');
    expect(coreSource).toContain('presentation_metadata_stripped');
  });
});
