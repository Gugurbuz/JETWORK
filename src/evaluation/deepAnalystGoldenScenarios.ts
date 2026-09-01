export interface DeepAnalystGoldenFinding {
  id: string
  sourceType: 'internal_knowledge' | 'user_requirement' | 'external_web' | 'analysis'
  description: string
  requiredAnchors: string[]
}

export interface DeepAnalystGoldenScenario {
  id: string
  title: string
  runtimeInvariant: string
  forbiddenRuntimeRoutes: string[]
  expectedFindings: DeepAnalystGoldenFinding[]
}

/**
 * Test-only quality benchmark. Nothing in the production runtime imports this
 * file, so these anchors can never become product-specific routing rules.
 */
export const LRT_V3P_DEEP_ANALYST_GOLDEN: DeepAnalystGoldenScenario = {
  id: 'deep-analyst-lrt-v3p-001',
  title: 'LÜ Proforma LRT-V3P — requirement + current implementation + regulation analysis',
  runtimeInvariant: 'Controller must decide its own skill/knowledge/web sequence and re-plan from observations.',
  forbiddenRuntimeRoutes: [
    'if LRT-V3P -> knowledge query',
    'if analiz -> impact-analysis',
    'fixed knowledge query count',
    'fixed planner-research-analysis-critic sequence',
  ],
  expectedFindings: [
    {
      id: 'K01-signed-prepayment-loss',
      sourceType: 'internal_knowledge',
      description: 'Existing CHECK_PREPAYMENT compares ZZPREPAYMENT_DAY through abs(), which destroys the sign required to distinguish prepaid from postpaid for the target requirement.',
      requiredAnchors: ['CHECK_PREPAYMENT', 'abs', 'ZZPREPAYMENT_DAY', 'N-15', 'N+15'],
    },
    {
      id: 'K02-lrtv3-family-gap',
      sourceType: 'internal_knowledge',
      description: 'CHECK_LRTV3 has an explicit V3 product family and the new product is not covered automatically.',
      requiredAnchors: ['CHECK_LRTV3', 'LRT-V3P'],
    },
    {
      id: 'K03-c4c-family-gap',
      sourceType: 'internal_knowledge',
      description: 'CHECK_INDIRIM_ORAN_C4C contains exact product-family logic that must be assessed for the new product.',
      requiredAnchors: ['CHECK_INDIRIM_ORAN_C4C', 'LRT-V3P'],
    },
    {
      id: 'K04-ek-protokol-exact-match',
      sourceType: 'internal_knowledge',
      description: 'CHECK_EK_PROTOKOL2 exact-product branching creates a regression/behavior risk for the new product.',
      requiredAnchors: ['CHECK_EK_PROTOKOL2', 'LRT-V3P', 'ZONODEMETRH'],
    },
    {
      id: 'R01-refund-contradiction',
      sourceType: 'analysis',
      description: 'The requirement contains conflicting refund timing rules: invoice due date versus the seventh day of the second month after consumption.',
      requiredAnchors: ['iade', 'vade', '7'],
    },
    {
      id: 'R02-security-deposit-gap',
      sourceType: 'analysis',
      description: 'Signed prepayment-day ranges leave overlapping or undefined security-deposit intervals that require an explicit business decision.',
      requiredAnchors: ['teminat', 'N-15', 'N-1'],
    },
    {
      id: 'W01-6183-rate-semantics',
      sourceType: 'external_web',
      description: 'Article 51 rate is an effective-dated external regulatory value; the requirement asks for a daily finance-cost rate and therefore needs a defined monthly-to-daily conversion rule.',
      requiredAnchors: ['6183', '51', 'aylık', 'günlük'],
    },
  ],
}

export const DEEP_ANALYST_GOLDEN_SCENARIOS = [LRT_V3P_DEEP_ANALYST_GOLDEN] as const
