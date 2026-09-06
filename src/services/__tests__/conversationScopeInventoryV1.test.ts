import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactAssistantConversationMemory } from '../../../supabase/functions/_shared/conversationMemory';
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy';
import { executeClassInventoryTool } from '../../../supabase/functions/_shared/classInventoryTool';
import { buildDeterministicEnumerationFinalization } from '../../../supabase/functions/_shared/enumerationFinalizer';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';

const basePlan = (): ReasoningPlan => ({
  intent: 'analysis',
  complexity: 'medium',
  goal: 'hangi classlar var',
  knowledgeRequired: true,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  executionMode: 'knowledge',
  conversationState: {
    continuation: true,
    topic: 'zcrmcost hatalarının tümünü listele',
    userMove: 'follow_up',
    priorIntent: 'analysis',
    rejectedHypotheses: [],
    retainedContext: [],
    openQuestions: [],
  },
});

const classInventoryRaw = `# CRM Order Save Class Envanteri

| Sınıf | \`ZCL_ORDER_SAVE_QUOTATIONS\` |
| Üst sınıf | \`ZCL_ORDER_SAVE_GENERAL\` |

# ZCL_CRM_B2B_CIKTI_UI_UTIL
| Sınıf | \`ZCL_CRM_B2B_CIKTI_UI_UTIL\` |
| Açıklama | B2B çıktı utility metotları |

| \`ZCL_CRM_B2B_CIKTI_APPROVAL\` | Statü değişiklik yetkisi |
| \`ZCL_CRM_B2B_CIKTI_UTIL\` | Onay statü sabitleri |
| \`ZCL_CRM_B2B_CIKTI_CONFIG\` | Şablon uyarlamaları |

# ZCL_CRM_NINJA_TOOLS
| Sınıf | \`ZCL_CRM_NINJA_TOOLS\` |
| Açıklama | Ninja Tools Class |
`;

describe('Conversation Scope & Inventory Intelligence v1', () => {
  it('shifts a generic class follow-up away from the prior ZCRM_COST scope', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'hangi classlar var',
      conversation: [
        { role: 'user', content: 'zcrmcost hatalarının tümünü listele' },
        { role: 'assistant', content: '62 kayıt listelendi' },
      ],
    });
    expect(plan.enumerationTarget).toEqual({ tool: 'list_class_inventory', objectType: 'class', prefix: null, cursor: null });
    expect(plan.conversationState?.topic).toBe('class envanteri');
    expect(plan.conversationState?.userMove).toBe('topic_shift');
    expect(plan.goal).toContain('semantic search yerine hedef listeleme capabilitysini kullan');
  });

  it('records a completeness challenge as rejected narrow scope', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'class envanterinde daha çok olmalıydı',
      conversation: [{ role: 'assistant', content: 'Yalnızca iki Cost sınıfı var.' }],
    });
    expect(plan.conversationState?.userMove).toBe('correction');
    expect(plan.conversationState?.rejectedScopes?.join(' ')).toContain('zcrmcost');
    expect(plan.enumerationTarget?.tool).toBe('list_class_inventory');
  });

  it('does not widen an explicitly relational class question', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: basePlan(),
      currentMessage: 'ZCRM_COST ile ilgili hangi classlar var?',
      conversation: [],
    });
    expect(plan.enumerationTarget).toBeUndefined();
  });

  it('compacts a long deterministic list into structured follow-up memory', () => {
    const bullets = Array.from({ length: 62 }, (_, index) => `- **ZCRM_COST-${String(index).padStart(3, '0')}:** Hata ${index}`).join('\n');
    const full = `Kurumsal bilgi kataloğunda eşleşen **62 kayıt** bulundu. Tam liste:\n\n${bullets}\n\n<jetwork_meta>\n{"workSummary":["3 sayfada 62 kayıt toplandı ve pagination tamamlandı."],"questions":[],"actionSummary":"62 katalog kaydı deterministik olarak listelendi."}\n</jetwork_meta>`;
    const compact = compactAssistantConversationMemory(full, 1_200);
    expect(compact.length).toBeLessThan(1_200);
    expect(compact).toContain('deterministic_enumeration_total=62');
    expect(compact).toContain('ZCRM_COST-000');
    expect(compact).toContain('ZCRM_COST-061');
    expect(compact).not.toContain('Hata 30');
  });

  it('returns documented and referenced classes from the published inventory source', async () => {
    const client = {
      rpc: async (name: string) => {
        expect(name).toBe('get_class_inventory_sources_v1');
        return { data: [{ scope_type: 'global', source_id: 'source-1', source_name: 'CRM_Class_Envanteri.md', raw_text: classInventoryRaw }], error: null };
      },
    };
    const result = await executeClassInventoryTool(client, 'workspace-1', { prefix: null });
    const payload = JSON.parse(result.output);
    expect(payload.records.totalCount).toBe(7);
    expect(payload.records.documentedCount).toBe(3);
    expect(payload.records.referencedCount).toBe(4);
    expect(payload.records.items.map((item: any) => item.name)).toContain('ZCL_ORDER_SAVE_GENERAL');
    expect(payload.records.items.find((item: any) => item.name === 'ZCL_CRM_B2B_CIKTI_APPROVAL').inventoryRole).toBe('referenced');
  });

  it('finalizes the class inventory without a final LLM reinterpretation', async () => {
    const client = {
      rpc: async () => ({ data: [{ scope_type: 'global', source_id: 'source-1', source_name: 'CRM_Class_Envanteri.md', raw_text: classInventoryRaw }], error: null }),
    };
    const result = await executeClassInventoryTool(client, 'workspace-1', { prefix: null });
    const finalized = buildDeterministicEnumerationFinalization([
      { type: 'function_call', call_id: 'c1', name: 'list_class_inventory', arguments: JSON.stringify({ prefix: null }) },
      { type: 'function_call_output', call_id: 'c1', output: result.output },
    ]);
    expect(finalized).toMatchObject({ totalCount: 7, collectedCount: 7, complete: true, toolName: 'list_class_inventory' });
    expect(finalized!.text).toContain('Tam belgelenmiş sınıflar (3)');
    expect(finalized!.text).toContain('Referans verilen sınıflar (4)');
    expect(finalized!.text).toContain('ZCL_CRM_B2B_CIKTI_APPROVAL');
  });

  it('keeps the class inventory RPC authenticated-only', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20260810121200_class_inventory_source_rpc.sql', import.meta.url), 'utf8');
    expect(sql).toContain('public.resolve_knowledge_context(p_workspace_id)');
    expect(sql).toContain("sv.document_type = 'class_inventory'");
    expect(sql).toContain('revoke execute on function public.get_class_inventory_sources_v1(text) from public');
    expect(sql).toContain('from anon');
    expect(sql).toContain('to authenticated');
  });

  it('normalizes every Gemini selection to the production 3.8 runtime model', () => {
    const gateway = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url), 'utf8');
    const providers = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url), 'utf8');
    expect(gateway).toContain("DEFAULT_GEMINI_RUNTIME_MODEL = 'gemini-3.8-flash'");
    expect(gateway).toContain("requestedModel.startsWith('gemini-') ? DEFAULT_GEMINI_RUNTIME_MODEL : requestedModel");
    expect(gateway).not.toContain('requestedModel === GEMINI_FLASH_LITE_MODEL ? GEMINI_PRO_MODEL');
    expect(providers).toContain('model: requestedModel');
    expect(providers).toContain('primary_llm_agent_calls');
    expect(providers).not.toContain('cost_guard_provider_model_fallback: 1');
  });
});
