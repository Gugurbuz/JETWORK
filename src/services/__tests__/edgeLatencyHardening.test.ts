import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_INVENTORY_FAST_PATH_VERSION,
  buildAuthoritativeInventoryFastPlan,
  isAuthoritativeBroadClassInventoryRequest,
} from '../../../supabase/functions/_shared/authoritativeInventoryFastPath';

describe('edge latency hardening', () => {
  it.each([
    'hangi classlar var',
    'Hangi klaslar var',
    'classları listele',
    'tüm classları listele',
    'kaç class var',
    'class envanteri',
  ])('recognizes broad unfiltered class inventory request: %s', message => {
    expect(isAuthoritativeBroadClassInventoryRequest(message)).toBe(true);
    const plan = buildAuthoritativeInventoryFastPlan(message);
    expect(plan?.enumerationTarget).toEqual({
      tool: 'list_class_inventory',
      objectType: 'class',
      prefix: null,
      cursor: null,
    });
    expect(plan?.orchestratorVersion).toBe(AUTHORITATIVE_INVENTORY_FAST_PATH_VERSION);
  });

  it.each([
    'ZCL_CRM_NINJA_TOOLS classını anlat',
    'ZCL_CRM ile başlayan classlar hangileri',
    'zcrmcost ile ilgili classlar hangileri',
    'hangi class bu hatayı üretiyor',
    'class metodlarını listele',
  ])('does not bypass semantic orchestration for scoped or relational request: %s', message => {
    expect(isAuthoritativeBroadClassInventoryRequest(message)).toBe(false);
    expect(buildAuthoritativeInventoryFastPlan(message)).toBeNull();
  });

  it('wires the authoritative inventory fast path before semantic context loading', () => {
    const gateway = readFileSync(new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url), 'utf8');
    const fastPathCall = gateway.indexOf('tryAuthoritativeInventoryFastPath({');
    const semanticContextLoad = gateway.indexOf('loadSemanticContext({ authorization');
    expect(gateway).toContain("from '../_shared/authoritativeInventoryFastPath.ts'");
    expect(gateway).toContain('semanticPlannerBypassed: true');
    expect(fastPathCall).toBeGreaterThan(0);
    expect(semanticContextLoad).toBeGreaterThan(fastPathCall);
  });
});
