from pathlib import Path

core = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
text = core.read_text(encoding='utf-8')

state_anchor = """      let planForArtifactCompletion: ReasoningPlan | null = null
      let turnCompleted = false
      const runController = new AbortController()
"""
state_replacement = """      let planForArtifactCompletion: ReasoningPlan | null = null
      let turnCompleted = false
      let groundingRepairAttempted = false
      const runController = new AbortController()
"""
if 'let groundingRepairAttempted = false' not in text:
    if state_anchor not in text:
        raise SystemExit('state anchor missing')
    text = text.replace(state_anchor, state_replacement, 1)

loop_anchor = """        for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
          const mustSynthesize = round === MAX_TOOL_ROUNDS
"""
loop_replacement = """        let maxControllerRound = MAX_TOOL_ROUNDS
        for (let round = 0; round <= maxControllerRound; round += 1) {
          const mustSynthesize = round === maxControllerRound
"""
if 'let maxControllerRound = MAX_TOOL_ROUNDS' not in text:
    if loop_anchor not in text:
        raise SystemExit('loop anchor missing')
    text = text.replace(loop_anchor, loop_replacement, 1)

grounding_anchor = """            const groundingCoverage = evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
            const groundingBlocked = shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })
            if (groundingBlocked) {
              console.warn('ASSISTANT_GROUNDING_COVERAGE_BLOCKED', JSON.stringify({
"""
grounding_replacement = """            const groundingCoverage = evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
            const groundingBlocked = shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })
            const mayRequestGroundingRepair = AGENTIC_CONTROLLER_ENABLED
              && groundingBlocked
              && !groundingRepairAttempted
              && !roundTextStreamed
              && totalToolCalls < MAX_TOOL_CALLS
            if (mayRequestGroundingRepair) {
              groundingRepairAttempted = true
              // Reserve at most one tool-capable repair round plus one terminal synthesis round.
              // The runtime supplies validation feedback only; semantic next-action choice stays with Controller.
              maxControllerRound = Math.min(MAX_TOOL_ROUNDS + 2, Math.max(maxControllerRound, round + 2))
              const verifiedSourceCanonicals = sources
                .filter(source => source.sourceType !== 'web' && source.canonicalKey)
                .map(source => String(source.canonicalKey))
                .slice(0, 24)
              if (activeProvider === 'gemini' && latestGeminiInteractionId) {
                runItems.push(createGeminiProviderStateItem(latestGeminiInteractionId))
              }
              runItems.push({
                role: 'developer',
                content: [
                  '[GROUNDING_REPAIR_OBSERVATION]',
                  'Bir önceki aday yanıt final olarak reddedildi. Bu observation semantic plan değildir ve sıradaki aracı seçmez.',
                  `unsupportedIdentifiers=${JSON.stringify(groundingCoverage.unsupportedIdentifiers)}`,
                  `messageTextMismatches=${JSON.stringify(groundingCoverage.messageTextMismatches)}`,
                  `unsupportedClaims=${JSON.stringify(groundingCoverage.unsupportedClaims || [])}`,
                  `verifiedSourceCanonicals=${JSON.stringify(verifiedSourceCanonicals)}`,
                  'Mevcut current-turn function_call_output observationlarını yeniden değerlendir. Kanıt soruyu cevaplıyorsa yalnız doğrulanmış sonucu sentezle; doğrulanmamış identifier veya davranış ekleme.',
                  'Kullanıcı exact implementasyon istiyorsa ve doğrulanan nesne yalnız structural endpoint/call relation ise tam gövde varmış gibi yazma; nesne adını koruyarak tam implementasyon kaynağının bulunmadığını açıkça söyle.',
                  'Kullanıcı exact mesaj/ABAP satırı istiyorsa ve exact mesaj kaydı doğrulanmışsa, gerekiyorsa literal satırı doğrulamak için görünür knowledge capabilitylerinden hangisinin uygun olduğuna sen karar ver.',
                  'Sıradaki capability/tool çağrısı, sorgu, ek araştırma veya final cevap kararı yalnız Controller LLM olarak sana aittir.',
                ].join('\\n'),
              })
              usage = addUsage(usage, {
                grounding_repair_requested: 1,
                grounding_repair_unsupported_identifiers: groundingCoverage.unsupportedIdentifiers.length,
                grounding_repair_unsupported_claims: groundingCoverage.unsupportedClaims?.length || 0,
              })
              emitStatus('verifying', 'Grounding kontrolü aynı Controller’a düzeltme observationı olarak geri verildi')
              continue
            }
            if (groundingBlocked) {
              console.warn('ASSISTANT_GROUNDING_COVERAGE_BLOCKED', JSON.stringify({
"""
if '[GROUNDING_REPAIR_OBSERVATION]' not in text:
    if grounding_anchor not in text:
        raise SystemExit('grounding anchor missing')
    text = text.replace(grounding_anchor, grounding_replacement, 1)

core.write_text(text, encoding='utf-8')

test = Path('src/services/__tests__/groundingRepairV1.test.ts')
test.write_text("""import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('bounded grounding repair v1', () => {
  it('returns failed grounding to the same Controller once before fail-closed', () => {
    expect(coreSource).toContain('let groundingRepairAttempted = false')
    expect(coreSource).toContain('let maxControllerRound = MAX_TOOL_ROUNDS')
    expect(coreSource).toContain('[GROUNDING_REPAIR_OBSERVATION]')
    expect(coreSource).toContain('grounding_repair_requested')
    expect(coreSource).toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + 2')
    expect(coreSource).toContain('roundText = groundingFailureText()')
  })

  it('does not hard-code a semantic recovery tool or query', () => {
    const start = coreSource.indexOf('const mayRequestGroundingRepair')
    const end = coreSource.indexOf("console.warn('ASSISTANT_GROUNDING_COVERAGE_BLOCKED'", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const repairBlock = coreSource.slice(start, end)
    expect(repairBlock).not.toContain("runKnowledgeTool('")
    expect(repairBlock).not.toContain("toolName: 'get_")
    expect(repairBlock).not.toContain('search_knowledge_catalog')
    expect(repairBlock).toContain('Sıradaki capability/tool çağrısı, sorgu, ek araştırma veya final cevap kararı yalnız Controller LLM olarak sana aittir.')
  })

  it('allows only one repair attempt and preserves the terminal safety fallback', () => {
    expect(coreSource.match(/groundingRepairAttempted = true/g)?.length).toBe(1)
    expect(coreSource).toContain('&& !groundingRepairAttempted')
    expect(coreSource).toContain('grounding_fail_closed: 1')
    expect(coreSource).toContain('grounding_unverified_provider_text_discarded: 1')
  })
})
""", encoding='utf-8')

# Remove the temporary patch machinery from the product commit.
Path('.github/scripts/apply_controller_grounding_repair_v1.py').unlink(missing_ok=True)
Path('.github/workflows/controller-grounding-repair-patch.yml').unlink(missing_ok=True)
