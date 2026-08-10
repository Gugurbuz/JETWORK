import { describe, expect, it } from 'vitest';
import { filterUserFacingAssistantSse } from '../../../supabase/functions/_shared/userFacingAssistantSse';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let value = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    value += decoder.decode(chunk.value, { stream: true });
  }
  value += decoder.decode();
  return value;
}

function sourceFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('user-facing assistant SSE boundary', () => {
  it('removes status events while preserving visible response frames', async () => {
    const source = sourceFrom([
      'event: status\ndata: {"type":"status","stage":"planning","label":"Plan hazır"}\n\n',
      'event: text_delta\ndata: {"type":"text_delta","delta":"Merhaba"}\n\n',
      'event: sources\ndata: {"type":"sources","sources":[]}\n\n',
      'event: completed\ndata: {"type":"completed","model":"gpt-5.6-sol"}\n\n',
      'data: [DONE]\n\n',
    ]);

    const output = await collect(filterUserFacingAssistantSse(source));
    expect(output).not.toContain('event: status');
    expect(output).not.toContain('Plan hazır');
    expect(output).toContain('event: text_delta');
    expect(output).toContain('Merhaba');
    expect(output).toContain('event: sources');
    expect(output).toContain('event: completed');
    expect(output).toContain('data: [DONE]');
  });

  it('removes status frames even when transport chunks split frame boundaries', async () => {
    const source = sourceFrom([
      'event: sta',
      'tus\ndata: {"type":"status","stage":"verifying","label":"Kanıtlar doğrulanıyor"}\n',
      '\nevent: text_delta\ndata: {"type":"text_delta","delta":"OK"}\n',
      '\ndata: [DONE]\n\n',
    ]);

    const output = await collect(filterUserFacingAssistantSse(source));
    expect(output).not.toContain('Kanıtlar doğrulanıyor');
    expect(output).toContain('"delta":"OK"');
    expect(output).toContain('[DONE]');
  });

  it('also removes data-only status payloads', async () => {
    const source = sourceFrom([
      'data: {"type":"status","stage":"routing","label":"Talep sınıflandırıldı"}\n\n',
      'data: {"type":"text_delta","delta":"Yanıt"}\n\n',
    ]);

    const output = await collect(filterUserFacingAssistantSse(source));
    expect(output).not.toContain('Talep sınıflandırıldı');
    expect(output).toContain('Yanıt');
  });
});
