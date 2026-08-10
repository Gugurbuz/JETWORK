import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('conversation scope inventory static wiring', () => {
  it('wires the scope policy into the semantic gateway before forwarding', () => {
    const gateway = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url), 'utf8');
    expect(gateway).toContain("from '../_shared/conversationScopePolicy.ts'");
    expect(gateway).toContain('applyConversationScopeInventoryPolicy');
    expect(gateway).toContain('enumerationTool: semantic.plan.enumerationTarget?.tool');
  });

  it('exposes list_class_inventory to the shared tool contract and deterministic finalizer', () => {
    const tools = readFileSync(new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url), 'utf8');
    const finalizer = readFileSync(new URL('../../../supabase/functions/_shared/enumerationFinalizer.ts', import.meta.url), 'utf8');
    expect(tools).toContain('CLASS_INVENTORY_TOOL');
    expect(tools).toContain("toolName === 'list_class_inventory'");
    expect(finalizer).toContain("'list_knowledge_catalog','list_class_inventory'");
    expect(finalizer).toContain('buildClassInventoryText');
  });

  it('compacts assistant history for both Gemini and OpenAI provider paths', () => {
    const providers = readFileSync(new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url), 'utf8');
    const guard = readFileSync(new URL('../../../supabase/functions/_shared/geminiCostGuard.ts', import.meta.url), 'utf8');
    expect(providers).toContain('compactAssistantConversationMemory');
    expect(providers).toContain('cleanProviderItemsForOpenAi');
    expect(guard).toContain('compactAssistantConversationMemory(content, 1_200)');
  });
});
