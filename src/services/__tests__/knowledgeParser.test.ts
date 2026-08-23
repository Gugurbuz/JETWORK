import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PARSER_VERSION,
  parseKnowledgeSource,
} from '../../../supabase/functions/_shared/knowledgeParser';
import {
  KNOWLEDGE_COMPILER_VERSION,
  compileKnowledgeSource,
} from '../../../supabase/functions/_shared/knowledgeSemanticCompiler';

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
      expect.objectContaining({ canonicalKey: 'method:zcl_crm_ninja_tools/calculate', objectType: 'method' }),
    ]));
    expect(parsed.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceCanonicalKey: 'method:zcl_crm_ninja_tools/calculate', relationType: 'CALLS', targetCanonicalKey: 'function:z_active_function' }),
      expect.objectContaining({ relationType: 'EMITS_MESSAGE', targetCanonicalKey: 'message:zcrm_cost-015' }),
      expect.objectContaining({ relationType: 'READS', targetCanonicalKey: 'table:zcrm_table' }),
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
      expect.objectContaining({ canonicalKey: 'function:z_fica_tks_check', name: 'Z_FICA_TKS_CHECK' }),
    ]);
    expect(parsed.relations).toContainEqual(expect.objectContaining({
      sourceCanonicalKey: 'method:zcl_order_save_quotations/check_ztks',
      relationType: 'CALLS',
      targetCanonicalKey: 'function:z_fica_tks_check',
    }));
  });

  it('materializes every relation endpoint so the compiled graph has no dangling nodes', async () => {
    const deterministic = parseKnowledgeSource('functions.md', `
# CRM Function Module Envanteri

| Function Module | Tür | Çalışma | Kullanım | Çağıran sınıf / metot | Function Group | Kaynak |
|---|---|---|---:|---|---|---|
| \`Z_FICA_TKS_CHECK\` | Müşteri geliştirmesi | RFC | 1 | \`ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS\` | Bekleniyor | Bekleniyor |
`);
    const compiled = await compileKnowledgeSource('functions.md', 'same source', deterministic);
    const keys = new Set(compiled.objects.map(object => object.canonicalKey));

    expect(KNOWLEDGE_COMPILER_VERSION).toMatch(/^jetwork-knowledge-compiler\//);
    expect(keys.has('method:zcl_order_save_quotations/check_ztks')).toBe(true);
    expect(keys.has('function:z_fica_tks_check')).toBe(true);
    expect(compiled.compileStats.materializedEndpoints).toBe(1);
    for (const relation of compiled.relations) {
      expect(keys.has(relation.sourceCanonicalKey)).toBe(true);
      expect(keys.has(relation.targetCanonicalKey)).toBe(true);
    }
  });

  it('is deterministic for the same source', () => {
    const input = '# Genel Not\n\nKurumsal bilgi.';
    expect(parseKnowledgeSource('notes.md', input)).toEqual(parseKnowledgeSource('notes.md', input));
  });

  it('extracts architecture entities, relations and semantic chunks from a generic system document', () => {
    const parsed = parseKnowledgeSource('jetwork-mimari.md', `
# Jetwork Mimari

## Akış
Frontend UI -> Assistant Gateway
Assistant Gateway -> openai-assistant-core-v2
openai-assistant-core-v2 uses Supabase Postgres

## Bileşenler
- Assistant Gateway: Kullanıcı mesajını runtime'a taşır.
- Supabase Postgres: Bilgi bankası ve konuşma kayıtlarını saklar.

| Source | Relation | Target |
|---|---|---|
| openai-assistant-core-v2 | writes | knowledge_chunks_v2 |
`);

    expect(parsed.documentType).toBe('architecture_document');
    expect(parsed.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'document', canonicalKey: 'document:jetwork-mimari' }),
      expect.objectContaining({ objectType: 'service', name: 'Assistant Gateway' }),
      expect.objectContaining({ objectType: 'database', name: 'Supabase Postgres' }),
    ]));
    expect(parsed.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationType: 'CONNECTS_TO', sourceCanonicalKey: 'screen:frontend-ui', targetCanonicalKey: 'service:assistant-gateway' }),
      expect.objectContaining({ relationType: 'WRITES', targetCanonicalKey: 'database:knowledge_chunks_v2' }),
    ]));
    const document = parsed.objects.find(object => object.canonicalKey === 'document:jetwork-mimari');
    expect(document?.chunks?.length).toBeGreaterThan(1);
    expect(document?.metadata?.chunkCount).toBe(document?.chunks?.length);
  });
});
