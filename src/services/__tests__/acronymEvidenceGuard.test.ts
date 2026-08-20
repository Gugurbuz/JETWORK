import { describe, expect, it } from 'vitest';
import { sanitizeUnsupportedAcronymExpansions } from '../../../supabase/functions/_shared/acronymEvidenceGuard';

const evidence = `
## ZCRM2-545
Aktarımdaki tüm ilgili güvence kayıtları ZTKS kuralıyla uyumlu olmalıdır.
Kontrol noktaları:
- REASON = ZTKS
- ZGUVENCEIADE
`;

describe('sanitizeUnsupportedAcronymExpansions', () => {
  it.each([
    ['ZTKS (Güvence Türü Kontrol Sistemi / Kuralı)', 'ZTKS'],
    ['**ZTKS** (Güvence Türü Kontrol Sistemi / Kuralı)', '**ZTKS**'],
    ['__ZTKS__ (Güvence Türü Kontrol Sistemi / Kuralı)', '__ZTKS__'],
    ['`ZTKS` (Güvence Türü Kontrol Sistemi / Kuralı)', '`ZTKS`'],
    ['*ZTKS* (Güvence Türü Kontrol Sistemi / Kuralı)', '*ZTKS*'],
    ['_ZTKS_ (Güvence Türü Kontrol Sistemi / Kuralı)', '_ZTKS_'],
  ])('removes unsupported parenthetical expansions without dropping the verified identifier: %s', (input, expected) => {
    const result = sanitizeUnsupportedAcronymExpansions(input, evidence);
    expect(result.text).toBe(expected);
    expect(result.removed).toBe(1);
  });

  it('preserves a parenthetical expansion when the authoritative evidence contains it', () => {
    const source = 'Teknik sözlük: ZTKS (Zorunlu Tedarik Kart Sistemi).';
    const result = sanitizeUnsupportedAcronymExpansions(
      '**ZTKS** (Zorunlu Tedarik Kart Sistemi)',
      source,
    );

    expect(result.text).toBe('**ZTKS** (Zorunlu Tedarik Kart Sistemi)');
    expect(result.removed).toBe(0);
  });

  it('can sanitize multiple unsupported expansions in one streamed sentence', () => {
    const result = sanitizeUnsupportedAcronymExpansions(
      '**ZTKS** (Uydurma Açılım) ve `GBX` (Başka Uydurma Açılım) birlikte kontrol edilir.',
      evidence,
    );

    expect(result.text).toBe('**ZTKS** ve `GBX` birlikte kontrol edilir.');
    expect(result.removed).toBe(2);
  });
});
