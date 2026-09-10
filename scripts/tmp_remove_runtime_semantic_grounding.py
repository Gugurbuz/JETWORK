from pathlib import Path

p = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
s = p.read_text()
s = s.replace("import {\n  evaluateGroundedTechnicalClaims,\n  groundingFailureText,\n  resultHasVerifiedKnowledgeEvidence,\n  shouldFailClosedGroundedAnswer,\n} from '../_shared/groundingGuard.ts'\n", "")
s = s.replace("\n// Semantic truth/evidence sufficiency belongs to the Controller LLM. Runtime keeps\n// only mechanical provenance/persistence/security responsibilities and must not\n// replace a model answer via regex/identifier-based grounding adjudication.\nconst RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED = false\n", "")
s = s.replace("      let groundingRepairAttempted = false\n", "")
start = s.find("            const groundingCoverage = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED")
end = s.find("            const persistedTurnItems: Array<Record<string, unknown>>", start)
if start < 0 or end < 0:
    raise SystemExit('grounding finalization block markers not found')
s = s[:start] + s[end:]
s = s.replace("            if (activeProvider === 'gemini' && latestGeminiInteractionId && !groundingBlocked) {\n              persistedTurnItems.push(createGeminiProviderStateItem(latestGeminiInteractionId))\n              usage = addUsage(usage, { gemini_interaction_state_persisted: 1 })\n            } else if (activeProvider === 'gemini' && groundingBlocked) {\n              usage = addUsage(usage, { gemini_interaction_state_discarded_grounding: 1 })\n            }\n", "            if (activeProvider === 'gemini' && latestGeminiInteractionId) {\n              persistedTurnItems.push(createGeminiProviderStateItem(latestGeminiInteractionId))\n              usage = addUsage(usage, { gemini_interaction_state_persisted: 1 })\n            }\n")
old_summary = """                groundingCoverage: {
                  blocked: !groundingCoverage.ok,
                  unsupportedIdentifiers: groundingCoverage.unsupportedIdentifiers,
                  messageTextMismatchCount: groundingCoverage.messageTextMismatches.length,
                },
"""
new_summary = """                provenance: {
                  sourceCount: sources.length,
                  knowledgeSourceCount: sources.filter(source => source.sourceType !== 'web').length,
                  webSourceCount: sources.filter(source => source.sourceType === 'web').length,
                  semanticGroundingGate: false,
                },
"""
if old_summary not in s:
    raise SystemExit('grounding summary marker not found')
s = s.replace(old_summary, new_summary, 1)
p.write_text(s)

t = Path('src/services/__tests__/controllerOwnedEvidenceContinuity.test.ts')
ts = t.read_text()
old = """  it('disables runtime semantic grounding as a final-answer authority', () => {
    expect(coreSource).toContain('const RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED = false')
    expect(coreSource).toContain('const groundingCoverage = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(coreSource).toContain('const groundingBlocked = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(policySource).toContain('Runtime doğal dil iddialarını regex')
  })
"""
new = """  it('removes runtime semantic grounding from the live final-answer path', () => {
    expect(coreSource).not.toContain('RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(coreSource).not.toContain('evaluateGroundedTechnicalClaims')
    expect(coreSource).not.toContain('shouldFailClosedGroundedAnswer')
    expect(coreSource).not.toContain('groundingFailureText')
    expect(coreSource).not.toContain('[GROUNDING_REPAIR_OBSERVATION]')
    expect(coreSource).not.toContain('grounding_fail_closed')
    expect(coreSource).toContain('semanticGroundingGate: false')
    expect(policySource).toContain('Runtime doğal dil iddialarını regex')
  })
"""
if old not in ts:
    raise SystemExit('controller continuity test marker not found')
ts = ts.replace(old, new, 1)
t.write_text(ts)

Path('src/services/__tests__/groundingRepairV1.test.ts').write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')\nconst policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')\n\ndescribe('controller-owned evidence review', () => {\n  it('does not retain a runtime grounding repair/fail-closed loop', () => {\n    expect(coreSource).not.toContain('[GROUNDING_REPAIR_OBSERVATION]')\n    expect(coreSource).not.toContain('groundingRepairAttempted')\n    expect(coreSource).not.toContain('groundingFailureText')\n    expect(coreSource).not.toContain('grounding_fail_closed')\n  })\n  it('leaves evidence sufficiency and next-action semantics to Controller', () => {\n    expect(policySource).toContain('Evidence yeterliliği, çelişki, belirsizlik ve stop/final kararı Controller LLM')\n  })\n})\n""")
Path('src/services/__tests__/groundingFailClosedCompletionContract.test.ts').write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')\n\ndescribe('runtime semantic grounding removal contract', () => {\n  it('cannot replace a Controller answer with the former generic grounding failure text', () => {\n    expect(coreSource).not.toContain('Bu teknik yanıtı güvenli biçimde tamamlayamadım:')\n    expect(coreSource).not.toContain('groundingFailureText')\n    expect(coreSource).not.toContain('ASSISTANT_GROUNDING_COVERAGE_BLOCKED')\n  })\n})\n""")

for path in [
    'src/services/__tests__/productionAnswerabilityCostGuard.test.ts',
    'src/services/__tests__/agenticSemanticAuthorityLeakRegression.test.ts',
    'src/services/__tests__/trueLiveStreamingContract.test.ts',
]:
    f = Path(path)
    if not f.exists(): continue
    x = f.read_text()
    x = x.replace("expect(coreSource).toContain('evaluateGroundedTechnicalClaims')", "expect(coreSource).not.toContain('evaluateGroundedTechnicalClaims')")
    x = x.replace("expect(coreSource).toContain('shouldFailClosedGroundedAnswer')", "expect(coreSource).not.toContain('shouldFailClosedGroundedAnswer')")
    x = x.replace("expect(coreSource).toContain('groundingFailureText()')", "expect(coreSource).not.toContain('groundingFailureText')")
    x = x.replace("expect(coreSource).toContain('evaluateGroundedTechnicalClaims({')", "expect(coreSource).not.toContain('evaluateGroundedTechnicalClaims')")
    x = x.replace("expect(coreSource).toContain('shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })')", "expect(coreSource).not.toContain('shouldFailClosedGroundedAnswer')")
    x = x.replace("expect(coreSource).toContain('roundText = groundingFailureText()')", "expect(coreSource).not.toContain('groundingFailureText')")
    f.write_text(x)

Path('src/services/__tests__/runtimeNoSemanticGroundingGate.test.ts').write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')\nconst policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')\n\ndescribe('runtime has no semantic grounding authority', () => {\n  it('keeps final-answer semantics entirely in the Controller', () => {\n    for (const forbidden of ['evaluateGroundedTechnicalClaims','shouldFailClosedGroundedAnswer','groundingFailureText','[GROUNDING_REPAIR_OBSERVATION]','ASSISTANT_GROUNDING_COVERAGE_BLOCKED','grounding_fail_closed']) expect(coreSource).not.toContain(forbidden)\n    expect(policySource).toContain('Evidence yeterliliği, çelişki, belirsizlik ve stop/final kararı Controller LLM')\n  })\n  it('retains mechanical provenance telemetry only', () => {\n    expect(coreSource).toContain('provenance: {')\n    expect(coreSource).toContain('sourceCount: sources.length')\n    expect(coreSource).toContain('semanticGroundingGate: false')\n  })\n})\n""")
