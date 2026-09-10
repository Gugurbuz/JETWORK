from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != expected:
        raise SystemExit(f'{path}: expected {expected} matches, got {actual}: {old[:160]!r}')
    p.write_text(text.replace(old, new, expected))


# 1) Gemini 3.8 Flash latency policy.
# Keep semantic authority in the model. Balanced stays capable, but uses the model's
# supported low thinking level; explicit deep mode remains high.
gemini_path = 'supabase/functions/_shared/geminiInteractionsRuntimeV3.ts'
replace_exact(
    gemini_path,
    "const thinkingLevel = (mode: GeminiInteractionWorkMode | undefined) => (\n  mode === 'fast' ? 'low' : mode === 'deep' ? 'high' : 'medium'\n)\n",
    "const thinkingLevel = (mode: GeminiInteractionWorkMode | undefined) => (\n  mode === 'deep' ? 'high' : 'low'\n)\n",
)

# 2) V5 progressive disclosure remains available but it may no longer extend the
# controller's normal model-round budget. Cap navigation itself to three calls:
# index -> guide -> contract. This is a mechanical execution budget, not routing.
core_path = 'supabase/functions/openai-assistant-core-v2/implementation.ts'
replace_exact(
    core_path,
    "const MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 8, 3, 12)\n",
    "const MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 3, 1, 6)\n",
)
replace_exact(
    core_path,
    "        let maxControllerRound = MAX_TOOL_ROUNDS\n        let disclosureControlRounds = 0\n        let evidenceFinalSynthesisAttempted = false\n",
    "        let maxControllerRound = MAX_TOOL_ROUNDS\n        let evidenceFinalSynthesisAttempted = false\n",
)
replace_exact(
    core_path,
    "          const functionCalls = output.filter((item: Record<string, unknown>) => item.type === 'function_call')\n          const disclosureOnlyRound = functionCalls.length > 0\n            && functionCalls.every((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)\n          if (disclosureOnlyRound && disclosureControlRounds < MAX_CAPABILITY_DISCLOSURE_CALLS) {\n            disclosureControlRounds += 1\n            maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS, maxControllerRound + 1)\n            usage = addUsage(usage, { capability_disclosure_control_rounds: 1 })\n          }\n          if (!functionCalls.length) {\n",
    "          const functionCalls = output.filter((item: Record<string, unknown>) => item.type === 'function_call')\n          if (!functionCalls.length) {\n",
)

# 3) Lock the regression in tests.
gemini_test = 'src/services/__tests__/geminiInteractionsAgentV3.test.ts'
replace_exact(
    gemini_test,
    "      thinking_level: 'medium',\n      tool_choice: 'validated',\n",
    "      thinking_level: 'low',\n      tool_choice: 'validated',\n",
)

budget_test = Path('src/services/__tests__/capabilityDisclosureControlPlaneBudgetV5.test.ts')
budget_test.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(\n  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),\n  'utf8',\n)\n\ndescribe('V5 capability disclosure latency budget', () => {\n  it('keeps disclosure separate from substantive tool calls but caps navigation tightly', () => {\n    expect(coreSource).toContain(\"MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 3, 1, 6)\")\n    expect(coreSource).toContain('let capabilityDisclosureCalls = 0')\n    expect(coreSource).toContain('capabilityDisclosureCalls += 1')\n    expect(coreSource).toContain('capability_disclosure_control_calls: 1')\n    expect(coreSource).toContain('toolName !== DISCOVER_MORE_CAPABILITIES_TOOL_NAME && totalToolCalls >= MAX_TOOL_CALLS')\n  })\n\n  it('never grants disclosure-only rounds extra model calls beyond the normal controller budget', () => {\n    expect(coreSource).toContain('let maxControllerRound = MAX_TOOL_ROUNDS')\n    expect(coreSource).not.toContain('let disclosureControlRounds = 0')\n    expect(coreSource).not.toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS')\n    expect(coreSource).not.toContain('capability_disclosure_control_rounds: 1')\n  })\n\n  it('keeps the latency boundary mechanical rather than semantic', () => {\n    expect(coreSource).not.toContain('LRT_CONTROL_PLANE')\n    expect(coreSource).not.toContain('CHECK_LRTV3_CONTROL')\n    expect(coreSource).not.toContain(\"if (query.includes('LRT'))\")\n  })\n})\n""")

print('Latency regression patch applied.')
