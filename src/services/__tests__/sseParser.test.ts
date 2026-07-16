import { describe, expect, it } from 'vitest';
import { consumeSseBuffer } from '../sseParser';

describe('consumeSseBuffer', () => {
  it('preserves partial frames across chunks', () => {
    let buffer = '';
    const events: string[] = [];
    for (const chunk of ['data: {"a":', '1}\n\ndata: {"b":2}', '\n\n']) {
      buffer += chunk;
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remainder;
      events.push(...parsed.events.map(event => event.data));
    }
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(buffer).toBe('');
  });

  it('flushes a final event without a trailing separator', () => {
    const parsed = consumeSseBuffer('data: {"final":true}', true);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].data).toBe('{"final":true}');
    expect(parsed.remainder).toBe('');
  });

  it('supports CRLF, comments, and multi-line data', () => {
    const parsed = consumeSseBuffer(': keep-alive\r\nevent: message\r\ndata: first\r\ndata: second\r\n\r\n');
    expect(parsed.events[0]).toMatchObject({ event: 'message', data: 'first\nsecond' });
  });
});
