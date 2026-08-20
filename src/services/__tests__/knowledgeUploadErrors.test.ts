import { describe, expect, it } from 'vitest';
import {
  isKnowledgeTransportError,
  toKnowledgeFunctionOperationError,
  toKnowledgeOperationError,
} from '../knowledgeUploadErrors';

describe('knowledge upload transport errors', () => {
  it.each([
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'Network request failed',
    'fetch failed',
  ])('recognizes browser transport failure: %s', message => {
    expect(isKnowledgeTransportError(new Error(message))).toBe(true);
  });

  it('converts raw transport failures into an actionable Turkish error', () => {
    const error = toKnowledgeOperationError(
      new TypeError('Failed to fetch'),
      'Bilgi kaynağı dosyası yüklenirken',
    );

    expect(error.message).toBe(
      'Bilgi kaynağı dosyası yüklenirken Supabase bağlantısı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.',
    );
  });

  it('preserves non-transport errors', () => {
    const original = new Error('row-level security policy blocked upload');
    expect(toKnowledgeOperationError(original, 'Bilgi kaynağı yüklenirken')).toBe(original);
  });

  it('reads and localizes the Edge Function response instead of showing the generic non-2xx error', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({
        error: 'column reference "object_version_id" is ambiguous',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(toKnowledgeFunctionOperationError(
      error,
      'Bilgi kaynağı işlenirken',
    )).resolves.toMatchObject({
      message: 'Bilgi kaynağı işlenirken sunucu tarafında tamamlanamadı. Lütfen tekrar deneyin.',
    });
  });

  it('translates known authorization errors returned by the Edge Function', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'Knowledge space access denied.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(toKnowledgeFunctionOperationError(
      error,
      'Bilgi kaynağı işlenirken',
    )).resolves.toMatchObject({
      message: 'Bu bilgi bankasına dosya ekleme yetkiniz yok.',
    });
  });
});
