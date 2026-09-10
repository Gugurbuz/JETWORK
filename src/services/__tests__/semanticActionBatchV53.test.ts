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
      EXECUTE_CAPABILITIES_TOOL_NAME,
      'request_large_context',
    ])
    expect(surface.toolNames).not.toContain('discover_more_capabilities')
    expect(surface.logicalToolNames).toHaveLength(33)
  })

  it('exposes a compact model-readable menu while keeping canonical schemas runtime-side', () => {
    const tool = buildExecuteCapabilitiesTool()
    expect(tool.name).toBe(EXECUTE_CAPABILITIES_TOOL_NAME)
    expect(tool.description).toContain('search_knowledge_catalog(query, limit)')
    expect(tool.description).toContain('get_abap_source')
    expect(tool.description).toContain('get_message_detail')
    expect(tool.description).toContain('sole semantic authority')
    expect(tool.description).not.toContain('LRT')
    expect(tool.description).not.toContain('CHECK_LRTV3')
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

  it('keeps candidate provenance mechanical without blocking progress or final answers', () => {
    expect(coreSource).toContain('const verifiedEvidence = resultHasVerifiedKnowledgeEvidence(result)')
    expect(coreSource).toContain('candidateOnly')
    expect(coreSource).toContain('acceptedSourceRefs')
    expect(coreSource).toContain('omittedSourceRefs')
    expect(coreSource).toContain('public_progress_unverified_source_ref_omitted')
    expect(coreSource).toContain('without blocking progress or final answer generation')
    expect(coreSource).not.toContain('UNVERIFIED_PROGRESS_SOURCE_REF')
    expect(surfaceSource).toContain('citationReady=false / verifiedEvidence=false')
    expect(surfaceSource).toContain('not verified source evidence by itself')
  })

  it('accepts the first post-verified-batch no-tool answer without a redundant evidence-only Gemini round', () => {
    expect(coreSource).toContain('let verifiedSemanticBatchEvidenceSeen = false')
    expect(coreSource).toContain('semantic_batch_verified_evidence_seen: 1')
    expect(coreSource).toContain('&& !verifiedSemanticBatchEvidenceSeen')
  })

  it('treats acronym expansion as a generic semantic completion requirement, not a product-specific route', () => {
    expect(policySource).toContain('yalnız kullanım alanını veya ürün ailesini tarif etmek görevi tamamlamaz')
    expect(policySource).toContain('yüksek güvenli standart sektör/genel açılımını')
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
