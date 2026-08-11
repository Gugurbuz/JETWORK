import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_KNOWLEDGE_TOOLS } from '../../../supabase/functions/_shared/assistantTools';
import { executeClassInventoryTool } from '../../../supabase/functions/_shared/classInventoryTool';
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy';
import { buildDeterministicEnumerationFinalization } from '../../../supabase/functions/_shared/enumerationFinalizer';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';

const rawInventory = `# ZCL_CRM_NINJA_TOOLS\n| Sınıf | \`ZCL_CRM_NINJA_TOOLS\` |\n| Açıklama | Ninja Tools |\n\n# ZCL_ORDER_SAVE_QUOTATIONS\n| Sınıf | \`ZCL_ORDER_SAVE_QUOTATIONS\` |\n| Üst sınıf | \`ZCL_ORDER_SAVE_GENERAL\` |`;

const plan = (): ReasoningPlan => ({
  intent: 'analysis', complexity: 'low', goal: 'hangi classlar var', knowledgeRequired: true,
  webMode: 'none', verificationRequired: false, creativeMode: false, evidenceQueries: [], steps: [],
  executionMode: 'knowledge',
  conversationState: {
    continuation: true, topic: 'zcrmcost hatalarının tümünü listele', userMove: 'follow_up', priorIntent: 'analysis',
    rejectedHypotheses: [], retainedContext: ['ZCRM_COST-000', 'ZCRM_COST-165'], openQuestions: [],
  },
});

const stripSqlComments = (value: string) => value
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('Inventory Runtime Hardening', () => {
  it('makes the dedicated class inventory capability exhaustive and argument-immutable', () => {
    const tool = ASSISTANT_KNOWLEDGE_TOOLS.find(candidate => candidate.name === 'list_class_inventory') as any;
    expect(tool).toBeTruthy();
    expect(tool.parameters.properties).toEqual({});
    expect(tool.parameters.required).toEqual([]);
    expect(tool.description).toContain('intentionally unfiltered');
  });

  it('does not let a leaked ZCRM prefix narrow a broad class inventory request', async () => {
    const client = {
      rpc: async () => ({
        data: [{ scope_type: 'global', source_id: 'source-1', source_name: 'CRM_Class_Envanteri.md', raw_text: rawInventory }],
        error: null,
      }),
    };
    const result = await executeClassInventoryTool(client, 'workspace-1', { prefix: 'ZCRM' });
    const payload = JSON.parse(result.output);
    expect(payload.records.totalCount).toBe(3);
    expect(payload.records.items.map((item: any) => item.name)).toEqual([
      'ZCL_CRM_NINJA_TOOLS', 'ZCL_ORDER_SAVE_GENERAL', 'ZCL_ORDER_SAVE_QUOTATIONS',
    ]);
    expect(result.summary).toMatchObject({ prefix: null, exhaustive: true, modelArgumentsIgnored: true });
  });

  it('preserves the planner class-inventory target after a ZCRM_COST conversation', () => {
    const result = applyConversationScopeInventoryPolicy({
      plan: plan(), currentMessage: 'hangi classlar var',
      conversation: [
        { role: 'user', content: 'zcrmcost hatalarının tümünü listele' },
        { role: 'assistant', content: '62 kayıt listelendi' },
      ],
    });
    expect(result.enumerationTarget).toEqual({ tool: 'list_class_inventory', objectType: 'class', prefix: null, cursor: null });
    expect(result.goal).toContain('prefix=null');
  });

  it('still finalizes class inventory deterministically even if a legacy agent sent a prefix argument', async () => {
    const client = {
      rpc: async () => ({
        data: [{ scope_type: 'global', source_id: 'source-1', source_name: 'CRM_Class_Envanteri.md', raw_text: rawInventory }],
        error: null,
      }),
    };
    const result = await executeClassInventoryTool(client, 'workspace-1', { prefix: 'ZCRM' });
    const finalized = buildDeterministicEnumerationFinalization([
      { type: 'function_call', call_id: 'inventory-1', name: 'list_class_inventory', arguments: JSON.stringify({ prefix: 'ZCRM' }) },
      { type: 'function_call_output', call_id: 'inventory-1', output: result.output },
    ]);
    expect(finalized).toMatchObject({ totalCount: 3, collectedCount: 3, complete: true, toolName: 'list_class_inventory' });
    expect(finalized!.text).toContain('ZCL_ORDER_SAVE_QUOTATIONS');
    expect(finalized!.text).not.toMatch(/kayıt bulunamadı|runtime error/i);
  });

  it('surfaces PostgREST error details instead of collapsing them to a generic runtime error', async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: {
          message: 'cannot execute INSERT in a read-only transaction',
          code: '25006',
          details: 'SQL function declared STABLE',
          hint: 'remove side effects',
        },
      }),
    };
    await expect(executeClassInventoryTool(client, 'workspace-1', {})).rejects.toThrow(/read-only transaction.*25006.*STABLE.*side effects/i);
  });

  it('keeps the replacement inventory RPC read-only and side-effect free', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/20260810143800_class_inventory_readonly_rpc.sql', import.meta.url), 'utf8');
    const executableSql = stripSqlComments(sql);
    expect(executableSql).toContain('language plpgsql');
    expect(executableSql).toContain('stable');
    expect(executableSql).toContain('public.is_workspace_member(p_workspace_id)');
    expect(executableSql).toContain('public.is_project_member_v2(current_project_id)');
    expect(executableSql).not.toContain('resolve_knowledge_context(');
    expect(executableSql).not.toMatch(/\binsert\s+into\b/i);
    expect(executableSql).not.toMatch(/\bupdate\s+public\./i);
    expect(executableSql).not.toMatch(/\bdelete\s+from\b/i);
    expect(executableSql).toContain('from anon');
    expect(executableSql).toContain('to authenticated');
  });
});
