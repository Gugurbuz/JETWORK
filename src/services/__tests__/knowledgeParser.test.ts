import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PARSER_VERSION,
  parseKnowledgeSource,
} from '../../../supabase/functions/_shared/knowledgeParser';

describe('knowledge catalog parser', () => {
  it('extracts scoped ABAP methods and only active dependencies', () => {
    const parsed = parseKnowledgeSource('methods.txt', `
* Doğrulanan sınıf: ZCL_ORDER_SAVE_QUOTATIONS
* CLASS : ZCL_CRM_NINJA_TOOLS
  METHOD calculate.
*   CALL FUNCTION 'COMMENTED_FUNCTION'.
    CALL FUNCTION 'Z_ACTIVE_FUNCTION'.
    MESSAGE e015(zcrm_cost).
    SELECT * FROM zcrm_table INTO TABLE @DATA(rows).
  ENDMETHOD.
`);

    expect(KNOWLEDGE_PARSER_VERSION).toMatch(/^jetwork-kb-parser\//);
    expect(parsed.documentType).toBe('abap_method_archive');
    expect(parsed.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        canonicalKey: 'method:zcl_crm_ninja_tools/calculate',
        objectType: 'method',
      }),
    ]));
    expect(parsed.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceCanonicalKey: 'method:zcl_crm_ninja_tools/calculate',
        relationType: 'CALLS',
        targetCanonicalKey: 'function:z_active_function',
      }),
      expect.objectContaining({
        relationType: 'EMITS_MESSAGE',
        targetCanonicalKey: 'message:zcrm_cost-015',
      }),
      expect.objectContaining({
        relationType: 'READS',
        targetCanonicalKey: 'table:zcrm_table',
      }),
    ]));
    expect(parsed.relations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ targetCanonicalKey: 'function:commented_function' }),
    ]));
  });

  it('turns each error guide record into an exact message object', () => {
    const parsed = parseKnowledgeSource('errors.md', `
# CRM Hata Bilgi Bankası

## ZCRM_COST-001 — Aynı kayıt kullanılamaz.
- **Kategori:** Seçim
- **Önem:** Hata

### İş kuralı
Kayıt benzersiz olmalıdır.

## ZCRM-545 — Ürün bulunamadı.
- **Kategori:** Ürün
- **Önem:** Uyarı
`);

    expect(parsed.documentType).toBe('error_knowledge_base');
    expect(parsed.objects).toHaveLength(2);
    expect(parsed.objects.map(object => object.canonicalKey)).toEqual([
      'message:zcrm_cost-001',
      'message:zcrm-545',
    ]);
  });

  it('extracts the full function catalog and caller relations from inventory rows', () => {
    const parsed = parseKnowledgeSource('functions.md', `
# CRM Function Module Envanteri

## Ana envanter
| Function Module | Tür | Çalışma | Kullanım | Çağıran sınıf / metot | Function Group | Kaynak |
|---|---|---|---:|---|---|---|
| \`Z_FICA_TKS_CHECK\` | Müşteri geliştirmesi | RFC | 1 | \`ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS\` | Bekleniyor | Bekleniyor |

## Ayrıntılar
### \`Z_FICA_TKS_CHECK\`
- Çalışma biçimi: **RFC**
`);

    expect(parsed.documentType).toBe('function_inventory');
    expect(parsed.objects).toEqual([
      expect.objectContaining({
        canonicalKey: 'function:z_fica_tks_check',
        name: 'Z_FICA_TKS_CHECK',
      }),
    ]);
    expect(parsed.relations).toContainEqual(expect.objectContaining({
      sourceCanonicalKey: 'method:zcl_order_save_quotations/check_ztks',
      relationType: 'CALLS',
      targetCanonicalKey: 'function:z_fica_tks_check',
    }));
  });

  it('is deterministic for the same source', () => {
    const input = '# Genel Not\n\nKurumsal bilgi.';
    expect(parseKnowledgeSource('notes.md', input))
      .toEqual(parseKnowledgeSource('notes.md', input));
  });
});
