const CAMEL_KEY_OVERRIDES: Record<string, string> = {
  photoURL: 'photo_url',
};

const SNAKE_KEY_OVERRIDES: Record<string, string> = {
  photo_url: 'photoURL',
};

const TIMESTAMP_COLUMNS = new Set(['created_at', 'last_updated', 'updated_at']);

export const camelToSnakeKey = (key: string): string => {
  if (CAMEL_KEY_OVERRIDES[key]) return CAMEL_KEY_OVERRIDES[key];
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

export const snakeToCamelKey = (key: string): string => {
  if (SNAKE_KEY_OVERRIDES[key]) return SNAKE_KEY_OVERRIDES[key];
  return key.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase());
};

export const camelToSnake = <T = any>(obj: Record<string, any>): T => {
  const out: Record<string, any> = {};
  for (const key in obj) {
    if (obj[key] === undefined) continue;
    out[camelToSnakeKey(key)] = obj[key];
  }
  return out as T;
};

export const rowToCamel = <T = any>(row: any): T | null => {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const key in row) {
    const camel = snakeToCamelKey(key);
    if (TIMESTAMP_COLUMNS.has(key) && row[key]) {
      out[camel] = new Date(row[key]).getTime();
    } else {
      out[camel] = row[key];
    }
  }
  return out as T;
};

export const rowsToCamel = <T = any>(rows: any[] | null | undefined): T[] => {
  if (!rows) return [];
  return rows.map((r) => rowToCamel<T>(r)!).filter(Boolean);
};

export const nowIso = (): string => new Date().toISOString();
