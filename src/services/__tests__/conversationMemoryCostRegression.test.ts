import { describe, expect, it } from 'vitest';
import { compactAssistantConversationMemory } from '../../../supabase/functions/_shared/conversationMemory';

const zcrmList = Array.from({ length: 62 }, (_, index) => {
  const code = String(index).padStart(3, '0');
  return `- **ZCRM_COST-${code}:** ${'Uzun kurumsal hata açıklaması '.repeat(5)}`;
}).join('\n');

describe('deterministic follow-up memory cost regression', () => {
  it('shrinks a large enumeration response by more than 80% while retaining inventory facts', () => {
    const source = `Kurumsal bilgi kataloğunda eşleşen **62 kayıt** bulundu. Tam liste:\n\n${zcrmList}\n\n<jetwork_meta>\n{"workSummary":["3 sayfada 62 kayıt toplandı ve pagination tamamlandı."],"questions":[],"actionSummary":"62 katalog kaydı deterministik olarak listelendi."}\n</jetwork_meta>`;
    const compact = compactAssistantConversationMemory(source, 1_200);
    expect(compact.length).toBeLessThan(source.length * 0.2);
    expect(compact).toContain('deterministic_enumeration_total=62');
    expect(compact).toContain('62 katalog kaydı deterministik olarak listelendi');
  });
});
