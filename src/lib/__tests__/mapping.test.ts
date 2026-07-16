import { describe, expect, it } from 'vitest';
import { camelToSnake, rowToCamel, rowsToCamel } from '../mapping';

describe('mapping', () => {
  it('maps application keys to database columns and omits undefined values', () => {
    expect(camelToSnake({ ownerId: 'u1', photoURL: 'avatar.png', optional: undefined })).toEqual({
      owner_id: 'u1',
      photo_url: 'avatar.png',
    });
  });

  it('maps timestamp columns to epoch milliseconds', () => {
    const row = rowToCamel<{ createdAt: number; ownerId: string }>({
      created_at: '2026-07-16T10:00:00.000Z',
      owner_id: 'u1',
    });

    expect(row?.createdAt).toBe(Date.parse('2026-07-16T10:00:00.000Z'));
    expect(row?.ownerId).toBe('u1');
    expect(rowsToCamel(null)).toEqual([]);
  });
});
