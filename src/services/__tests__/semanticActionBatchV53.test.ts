import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildControllerCapabilitySurface,
  buildExecuteCapabilitiesTool,
  EXECUTE_CAPABILITIES_TOOL_NAME,
  parseAndValidateCapabilityInvocation,
} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'
import {
  gateGeminiAgentToolsForPublicWork,
  PUBLIC_WORK_BATCH_TOOL_NAME,
} from '../../../supabase/functions/_shared/agent/publicWorkProtocol.ts'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const surfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)
const policySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)
const costGuardSource = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiCostGuard.ts', import.meta.url),
  'utf8',
)

describe('V5.3 semantic action batching', () => {
  it('keeps the provider surface compact without progressive-disclosure round trips', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.toolNames).toEqual([
      'report_progress',
      'discover_more_capabilities',
      EXECUTE_CAPABILITIES_TOOL_NAME,
      'request_large_context',
    ])
    expect(surface.toolNames).toContain('discover_more_capabilities')
    expect(surface.logicalToolNames).toHaveLength(33)
  })

  it('exposes a compact model-readable menu while keeping canonical schemas runtime-side', () => {
    const tool = buildExecuteCapabilitiesTool()
    expect(tool.name).toBe(EXECUTE_CAPABILITIES_TOOL_NAME)
    expect(tool.description).toContain('get_related_objects')
    expect(tool.description).toContain('EMITS_MESSAGE')
    expect(tool.description).toContain('discover_more_capabilities')
    expect(tool.description).toContain('semantic action batching runtime')
    expect(tool.description.length).toBeLessThan(3_000)
    expect(tool.description).not.toContain('LRT')
    expect(tool.description).not.toContain('CHECK_LRTV3')
  })

  it('uses structured verified evidence before raw observation reads', () => {
    expect(surfaceSource).toContain('truncated=true alone is not a reason')
    expect(surfaceSource).toContain('structured verifiedSignals, directRelations, relatedObjects')
    expect(surfaceSource).toContain('relation hints do not mean the linked object')
  })

  it('validates exact names and canonical argument schemas mechanically', () => {
    const valid = parseAndValidateCapabilityInvocation(
      'search_knowledge_catalog',
      JSON.stringify({ query: 'customer tariff code', limit: 8 }),
    )
    expect(valid.ok).toBe(true)

    const unknown = parseAndValidateCapabilityInvocation('made_up_tool', '{}')
    expect(unknown.ok).toBe(false)

    const invalid = parseAndValidateCapabilityInvocation(
      'search_knowledge_catalog',
      JSON.stringify({ query: 'x', limit: 8, invented: true }),
    )
    expect(invalid.ok).toBe(false)
  })

  it('allows start plus first action batch in one Controller response', () => {
    const tools = buildControllerCapabilitySurface().tools
    const gated = gateGeminiAgentToolsForPublicWork([], tools, false)
    expect(gated.started).toBe(false)
    expect(gated.tools.map(tool => tool.name)).toEqual([
      'report_progress',
      'discover_more_capabilities',
      PUBLIC_WORK_BATCH_TOOL_NAME,
    ])
  })

  it('executes independent model-authored actions as one mechanical parallel batch', () => {
    expect(coreSource).toContain('if (toolName === EXECUTE_CAPABILITIES_TOOL_NAME)')
    expect(coreSource).toContain('const batchResults = await Promise.all(validatedActions.map(async action =>')
    expect(coreSource).toContain('parseAndValidateCapabilityInvocation(capability, argumentsJson)')
    expect(coreSource).toContain('PUBLIC_WORK_START_REQUIRED')
    expect(coreSource).toContain("semantic_action_batch_v1")
    expect(coreSource).toContain('mechanicalValidationOnly: true')
  })

  it('executes valid actions even when a sibling action fails schema validation', () => {
    expect(coreSource).toContain('if (validationErrors.length && validatedActions.length === 0)')
    expect(coreSource).toContain('const validationFailureResults = validationErrors.map')
    expect(coreSource).toContain('const allBatchResults = [...batchResults, ...validationFailureResults]')
    expect(coreSource).toContain('partialExecution: validationErrors.length > 0 && batchResults.some')
    expect(coreSource).not.toContain('if (validationErrors.length || validatedActions.length !== rawActions.length)')
  })

  it('keeps public web discovery candidate-only and leaves URL selection to the Controller', () => {
    expect(coreSource).toContain("result.capability === 'search_web'")
    expect(coreSource).toContain('A search_web result is public discovery only')
    expect(coreSource).toContain('URL Context is available for you to inspect the candidate you choose')
    expect(coreSource).toContain('Runtime selected neither source nor next action')
    expect(policySource).toContain('Web discovery sonucu candidate-only ise snippet’i doğrulanmış wording sayma')
    expect(policySource).toContain('exact wording için URL Context ile o seçtiğin sayfayı incele')
  })

  it('keeps candidate provenance mechanical without blocking progress or final answers', () => {
    expect(coreSource).toContain('const verifiedEvidence = resultHasVerifiedKnowledgeEvidence(result)')
    expect(coreSource).toContain("|| action.capability === 'search_web'")
    expect(coreSource).toContain('webCandidateOnly')
    expect(coreSource).toContain('candidateOnly')
    expect(coreSource).toContain('acceptedSourceRefs')
    expect(coreSource).toContain('omittedSourceRefs')
    expect(coreSource).toContain('public_progress_unverified_source_ref_omitted')
    expect(coreSource).toContain('without blocking progress or final answer generation')
    expect(coreSource).not.toContain('UNVERIFIED_PROGRESS_SOURCE_REF')
    expect(surfaceSource).toContain('Discovery is candidate-only')
    expect(surfaceSource).toContain('exact/detail evidence provenance must be preserved')
  })

  it('deduplicates exact canonical evidence mechanically without choosing semantic routes', () => {
    expect(coreSource).toContain('const knowledgeToolCacheKey =')
    expect(coreSource).toContain("toolName === 'get_message_detail'")
    expect(coreSource).toContain("canonicalKey.startsWith('message:')")
    expect(coreSource).toContain('canonical_evidence_cache_hits')
    expect(coreSource).toContain('canonical_evidence_inflight_hits')
    expect(coreSource).toContain('toolResultInFlight')
    expect(coreSource).toContain('verifiedCanonicalEvidence')
    expect(coreSource).toContain('VERIFIED_EVIDENCE_LEDGER')
    expect(coreSource).toContain('VERIFIED_EVIDENCE_REQUIRED')
    expect(coreSource).not.toContain("if (message === '111')")
    expect(coreSource).not.toContain("if (query === 'ZCRM_COST-111')")
  })

  it('accepts the first post-verified-batch no-tool answer without a redundant evidence-only Gemini round', () => {
    expect(coreSource).toContain('let verifiedSemanticBatchEvidenceSeen = false')
    expect(coreSource).toContain('semantic_batch_verified_evidence_seen: 1')
    expect(coreSource).toContain('&& !verifiedSemanticBatchEvidenceSeen')
  })

  it('repairs only mechanically rejected literal source lines from verified evidence', () => {
    expect(coreSource).toContain('repairLiteralSourceLineFromVerifiedEvidence')
    expect(coreSource).toContain('UNVERIFIED_LITERAL_SOURCE_CODE_LINE:')
    expect(coreSource).toContain('literalEvidenceLinesFromOutput')
    expect(coreSource).toContain('literal_source_completion_repairs')
    expect(coreSource).toContain('repairAttempt < 8')
    expect(coreSource).toContain('answerLines.splice(rejectedIndex, 1)')
    expect(coreSource).toContain('literal_source_completion_retry_attempts')
  })

  it('treats acronym expansion as a generic semantic completion requirement, not a product-specific route', () => {
    expect(policySource).toContain('yalnız kullanım alanını veya ürün ailesini tarif etmek görevi tamamlamaz')
    expect(policySource).toContain('public web discovery yap')
    expect(policySource).toContain('yalnız finding yayınlamak için ayrı Controller turu harcama')
    expect(costGuardSource).toContain('yalnız kurumsal kullanım veya ürün ailesi açıklamasıyla yetinme')
    expect(costGuardSource).toContain('yüksek güvenli standart/sektörel açılımı model bilginden')
    expect(policySource).not.toContain('Last Resort Tariff')
    expect(costGuardSource).not.toContain('Last Resort Tariff')
  })

  it('contains no domain-specific semantic routing in the executor', () => {
    expect(surfaceSource).not.toContain("capability === 'search_knowledge_catalog' ?")
    expect(coreSource).not.toContain("if (query === 'LRT')")
    expect(coreSource).not.toContain("if (term === 'LRT')")
    expect(coreSource).not.toContain('Last Resort Tariff')
  })
})
