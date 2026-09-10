from pathlib import Path

core = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
s = core.read_text()

def rep(old, new, count=1):
    global s
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'expected {count} matches, got {actual}: {old[:120]!r}')
    s = s.replace(old, new, count)

rep(
"const MAX_TOOL_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_TOOL_CALLS', 24, 4, 40)\n",
"const MAX_TOOL_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_TOOL_CALLS', 24, 4, 40)\nconst MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 8, 3, 12)\n",
)
rep(
"      let totalToolCalls = 0\n      let skillToolCalls = 0\n",
"      let totalToolCalls = 0\n      let capabilityDisclosureCalls = 0\n      let skillToolCalls = 0\n",
)
rep(
"        if (!AGENTIC_CONTROLLER_ENABLED || !capabilitySession) throw new Error('Capability discovery session is unavailable.')\n        if (totalToolCalls >= MAX_TOOL_CALLS) throw new Error('Assistant exceeded the safe tool-call limit.')\n        const query = cleanString(args.query, 2_000)\n        if (query.length < 2) throw new Error('discover_more_capabilities requires a semantic query.')\n        totalToolCalls += 1\n        const startedAt = performance.now()\n",
"        if (!AGENTIC_CONTROLLER_ENABLED || !capabilitySession) throw new Error('Capability discovery session is unavailable.')\n        if (capabilityDisclosureCalls >= MAX_CAPABILITY_DISCLOSURE_CALLS) throw new Error('Assistant exceeded the safe capability-disclosure limit.')\n        const query = cleanString(args.query, 2_000)\n        if (query.length < 2) throw new Error('discover_more_capabilities requires a semantic query.')\n        capabilityDisclosureCalls += 1\n        usage = addUsage(usage, { capability_disclosure_control_calls: 1 })\n        const startedAt = performance.now()\n",
)
rep(
"        let maxControllerRound = MAX_TOOL_ROUNDS\n        let evidenceFinalSynthesisAttempted = false\n",
"        let maxControllerRound = MAX_TOOL_ROUNDS\n        let disclosureControlRounds = 0\n        let evidenceFinalSynthesisAttempted = false\n",
)
rep(
"          const functionCalls = output.filter((item: Record<string, unknown>) => item.type === 'function_call')\n          if (!functionCalls.length) {\n",
"          const functionCalls = output.filter((item: Record<string, unknown>) => item.type === 'function_call')\n          const disclosureOnlyRound = functionCalls.length > 0\n            && functionCalls.every((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)\n          if (disclosureOnlyRound && disclosureControlRounds < MAX_CAPABILITY_DISCLOSURE_CALLS) {\n            disclosureControlRounds += 1\n            maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS, maxControllerRound + 1)\n            usage = addUsage(usage, { capability_disclosure_control_rounds: 1 })\n          }\n          if (!functionCalls.length) {\n",
)
rep(
"          for (const call of functionCalls) {\n            if (totalToolCalls >= MAX_TOOL_CALLS) {\n              runItems.push({ type: 'function_call_output', call_id: String(call.call_id || ''), output: JSON.stringify({ error: 'TOOL_BUDGET_EXHAUSTED' }) })\n              continue\n            }\n            const toolName = cleanString(call.name, 120)\n            const callId = cleanString(call.call_id, 200)\n",
"          for (const call of functionCalls) {\n            const toolName = cleanString(call.name, 120)\n            const callId = cleanString(call.call_id, 200)\n            if (toolName !== DISCOVER_MORE_CAPABILITIES_TOOL_NAME && totalToolCalls >= MAX_TOOL_CALLS) {\n              runItems.push({ type: 'function_call_output', call_id: String(call.call_id || ''), output: JSON.stringify({ error: 'TOOL_BUDGET_EXHAUSTED' }) })\n              continue\n            }\n",
)
core.write_text(s)

test = Path('src/services/__tests__/capabilityDisclosureControlPlaneBudgetV5.test.ts')
test.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst coreSource = readFileSync(\n  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),\n  'utf8',\n)\n\ndescribe('V5 capability disclosure control-plane budget', () => {\n  it('keeps disclosure calls out of the substantive tool-call budget', () => {\n    expect(coreSource).toContain(\"MAX_CAPABILITY_DISCLOSURE_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS', 8, 3, 12)\")\n    expect(coreSource).toContain('let capabilityDisclosureCalls = 0')\n    expect(coreSource).toContain('capabilityDisclosureCalls += 1')\n    expect(coreSource).toContain('capability_disclosure_control_calls: 1')\n    expect(coreSource).toContain('toolName !== DISCOVER_MORE_CAPABILITIES_TOOL_NAME && totalToolCalls >= MAX_TOOL_CALLS')\n\n    const start = coreSource.indexOf('const runCapabilityDiscoveryTool = async')\n    const end = coreSource.indexOf('const runSkillTool', start) > start\n      ? coreSource.indexOf('const runSkillTool', start)\n      : coreSource.indexOf('const emitStatus', start)\n    const discoveryBody = coreSource.slice(start, end > start ? end : start + 7000)\n    expect(discoveryBody).not.toContain('totalToolCalls += 1')\n  })\n\n  it('does not spend a research round when the model is only navigating disclosure layers', () => {\n    expect(coreSource).toContain('let disclosureControlRounds = 0')\n    expect(coreSource).toContain('const disclosureOnlyRound = functionCalls.length > 0')\n    expect(coreSource).toContain('functionCalls.every((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)')\n    expect(coreSource).toContain('maxControllerRound = Math.min(MAX_TOOL_ROUNDS + MAX_CAPABILITY_DISCLOSURE_CALLS, maxControllerRound + 1)')\n    expect(coreSource).toContain('capability_disclosure_control_rounds: 1')\n  })\n\n  it('keeps the separation mechanical rather than semantic', () => {\n    expect(coreSource).not.toContain('LRT_CONTROL_PLANE')\n    expect(coreSource).not.toContain('CHECK_LRTV3_CONTROL')\n    expect(coreSource).not.toContain('if (query.includes(\'LRT\'))')\n  })\n})\n""")
