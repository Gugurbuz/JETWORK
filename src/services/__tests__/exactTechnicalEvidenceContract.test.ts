import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260810220500_add_exact_technical_evidence_contract.sql', import.meta.url),
  'utf8',
);

describe('exact technical evidence contract', () => {
  it('prioritizes direct implementation evidence and exact MESSAGE text', () => {
    expect(migration).toContain('[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]');
    expect(migration).toContain('implementasyon kaynağı');
    expect(migration).toContain('aktif MESSAGE ifadesiyle gerçekten üretilen mesajları listele');
    expect(migration).toContain('mesaj metnini anlamını değiştirmeden aynen kullan');
    expect(migration).toContain('Kaynak sayısını kalite göstergesi gibi anlatma');
  });

  it('keeps ordinary Q&A free of action/work summaries and provider chatter', () => {
    expect(migration).toContain('workSummary alanını []');
    expect(migration).toContain('actionSummary alanını boş string');
    expect(migration).toContain('"Ne yaptım?"');
    expect(migration).toContain('model/sağlayıcı bilgisi ekleme');
  });
});
