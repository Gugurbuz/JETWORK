import { describe, expect, it } from 'vitest';
import { executeClassInventoryTool } from '../../../supabase/functions/_shared/classInventoryTool';

describe('class inventory source roles', () => {
  it('prefers project inventory records and preserves documented/reference distinction', async () => {
    const globalRaw = '# ZCL_A\n| Sınıf | `ZCL_A` |\n| `ZCL_B` | global helper |';
    const projectRaw = '# ZCL_A\n| Sınıf | `ZCL_A` |\n| Açıklama | project A |\n| `ZCL_B` | project helper |';
    const client = { rpc: async () => ({ data: [
      { scope_type: 'project', source_id: 'p', source_name: 'project.md', raw_text: projectRaw },
      { scope_type: 'global', source_id: 'g', source_name: 'global.md', raw_text: globalRaw },
    ], error: null }) };
    const result = await executeClassInventoryTool(client, 'w', { prefix: null });
    const payload = JSON.parse(result.output);
    expect(payload.records.items).toHaveLength(2);
    expect(payload.records.items.find((item: any) => item.name === 'ZCL_A').scope).toBe('project');
    expect(payload.records.items.find((item: any) => item.name === 'ZCL_A').inventoryRole).toBe('documented');
    expect(payload.records.items.find((item: any) => item.name === 'ZCL_B').inventoryRole).toBe('referenced');
  });
});
