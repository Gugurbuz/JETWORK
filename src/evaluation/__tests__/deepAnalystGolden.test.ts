import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LRT_V3P_DEEP_ANALYST_GOLDEN } from '../deepAnalystGoldenScenarios'

const controllerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/agentControllerPolicy.ts', import.meta.url),
  'utf8',
)
const skillSource = readFileSync(
  new URL('../../../supabase/functions/_shared/skillTools.ts', import.meta.url),
  'utf8',
)
const runtimeSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('Deep Analyst golden benchmark', () => {
  it('captures the material LRT-V3P findings we expect from genuine research', () => {
    const ids = new Set(LRT_V3P_DEEP_ANALYST_GOLDEN.expectedFindings.map(item => item.id))
    expect(ids).toEqual(new Set([
      'K01-signed-prepayment-loss',
      'K02-lrtv3-family-gap',
      'K03-c4c-family-gap',
      'K04-ek-protokol-exact-match',
      'R01-refund-contradiction',
      'R02-security-deposit-gap',
      'W01-6183-rate-semantics',
    ]))
    expect(LRT_V3P_DEEP_ANALYST_GOLDEN.expectedFindings.some(item => item.sourceType === 'internal_knowledge')).toBe(true)
    expect(LRT_V3P_DEEP_ANALYST_GOLDEN.expectedFindings.some(item => item.sourceType === 'external_web')).toBe(true)
    expect(LRT_V3P_DEEP_ANALYST_GOLDEN.expectedFindings.some(item => item.sourceType === 'analysis')).toBe(true)
  })

  it('keeps golden scenario knowledge out of production routing code', () => {
    for (const source of [controllerSource, skillSource, runtimeSource]) {
      expect(source).not.toContain('LRT-V3P')
      expect(source).not.toContain('CHECK_PREPAYMENT')
      expect(source).not.toContain('CHECK_LRTV3')
    }
  })

  it('defines the abs/sign-loss finding as mandatory evidence rather than a prompt hint', () => {
    const finding = LRT_V3P_DEEP_ANALYST_GOLDEN.expectedFindings.find(item => item.id === 'K01-signed-prepayment-loss')!
    expect(finding.sourceType).toBe('internal_knowledge')
    expect(finding.requiredAnchors).toEqual(expect.arrayContaining(['CHECK_PREPAYMENT', 'abs', 'ZZPREPAYMENT_DAY']))
  })
})
