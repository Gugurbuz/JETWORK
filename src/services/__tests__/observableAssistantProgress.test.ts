import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const proxySource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/openai-assistant-live-proxy/index.ts'),
  'utf8',
);

describe('observable assistant progress', () => {
  it('does not synthesize time-based progress milestones in the live proxy', () => {
    expect(proxySource).not.toContain('scheduleStatus(');
    expect(proxySource).not.toContain("setTimeout(() =>");
    expect(proxySource).not.toContain('Talep türü ve çalışma yolu belirleniyor...');
    expect(proxySource).not.toContain('Çalışma planı hazırlanıyor...');
    expect(proxySource).not.toContain('Model için çalışma bağlamı hazırlanıyor...');
  });

  it('emits lifecycle progress at real proxy boundaries and preserves upstream streaming', () => {
    expect(proxySource).toContain("'X-JetWork-Live-Progress': 'v2'");
    expect(proxySource).toContain("label: 'Talep işleme alındı'");
    expect(proxySource).toContain("label: 'Konuşma bağlamı ve çalışma yolu hazırlanıyor...'");
    expect(proxySource).toContain("label: 'Çalışma yolu belirlendi; reasoning akışı başlatıldı'");
    expect(proxySource).toContain('const reader = upstream.body.getReader()');
    expect(proxySource).toContain('if (value) sink.write(value)');
  });
});
