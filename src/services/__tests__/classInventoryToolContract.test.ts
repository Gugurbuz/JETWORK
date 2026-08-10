import { describe, expect, it } from 'vitest';
import { ASSISTANT_KNOWLEDGE_TOOLS } from '../../../supabase/functions/_shared/assistantTools';

describe('class inventory tool contract', () => {
  it('offers a dedicated class inventory capability without widening generic search', () => {
    const inventory = ASSISTANT_KNOWLEDGE_TOOLS.find(tool => tool.name === 'list_class_inventory');
    expect(inventory).toBeTruthy();
    expect(JSON.stringify(inventory)).toContain('fully documented class entries');
    const search = ASSISTANT_KNOWLEDGE_TOOLS.find(tool => tool.name === 'search_knowledge_catalog');
    expect(JSON.stringify(search)).toContain('candidate evidence');
    expect(JSON.stringify(search)).toContain('not citations');
  });
});