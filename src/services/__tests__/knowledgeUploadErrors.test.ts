import { describe, expect, it } from 'vitest';
import {
  isKnowledgeTransportError,
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
      'Bilgi kaynağı dosyası yüklenirken sırasında Supabase bağlantısı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.',
    );
  });

  it('preserves non-transport errors', () => {
    const original = new Error('row-level security policy blocked upload');
    expect(toKnowledgeOperationError(original, 'Bilgi kaynağı yüklenirken')).toBe(original);
  });
});
