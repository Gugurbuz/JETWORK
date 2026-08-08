from pathlib import Path

core_path = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
core = core_path.read_text()

old_gemini = """            if (activeProvider === 'gemini') {
              return await requestGeminiResponse({
                apiKey: String(geminiApiKey), model: activeModel,
                instructions: [prompt.prompt_text, synthesisInstruction, finalInstruction].filter(Boolean).join('\\n\\n'),
                items: runItems, tools: ASSISTANT_KNOWLEDGE_TOOLS as unknown as ReadonlyArray<Record<string, unknown>>,
                allowTools: !mustSynthesize, maxOutputTokens: MAX_OUTPUT_TOKENS,
                onText: delta => { roundText += delta }, signal: runController.signal,
              })
            }
"""
new_gemini = """            if (activeProvider === 'gemini') {
              const allowSynthesisTools = !mustSynthesize && (plan.knowledgeRequired || plan.webMode !== 'none')
              return await requestGeminiResponse({
                apiKey: String(geminiApiKey), model: activeModel,
                instructions: [prompt.prompt_text, synthesisInstruction, finalInstruction].filter(Boolean).join('\\n\\n'),
                items: runItems, tools: ASSISTANT_KNOWLEDGE_TOOLS as unknown as ReadonlyArray<Record<string, unknown>>,
                allowTools: allowSynthesisTools, maxOutputTokens: MAX_OUTPUT_TOKENS,
                onText: delta => { roundText += delta }, signal: runController.signal,
              })
            }
"""
if old_gemini not in core:
    raise SystemExit('Gemini synthesis block not found')
core = core.replace(old_gemini, new_gemini, 1)

old_openai = """            const tools: Array<Record<string, unknown>> = [
              ...(ASSISTANT_KNOWLEDGE_TOOLS as unknown as Array<Record<string, unknown>>),
            ]
            if (!mustSynthesize && plan.webMode !== 'none') tools.push({
              type: 'web_search', search_context_size: plan.complexity === 'high' ? 'high' : 'medium',
            })
            return await requestOpenAiResponse(String(openAiApiKey), {
              model: activeModel, instructions: prompt.prompt_text,
              input: mustSynthesize
                ? [...cleanProviderItemsForOpenAi(runItems), { role: 'developer', content: finalInstruction }]
                : cleanProviderItemsForOpenAi(runItems),
              tools, tool_choice: mustSynthesize ? 'none' : 'auto', parallel_tool_calls: false,
"""
new_openai = """            const allowSynthesisTools = !mustSynthesize && (plan.knowledgeRequired || plan.webMode !== 'none')
            const tools: Array<Record<string, unknown>> = plan.knowledgeRequired
              ? [...(ASSISTANT_KNOWLEDGE_TOOLS as unknown as Array<Record<string, unknown>>)]
              : []
            if (!mustSynthesize && plan.webMode !== 'none') tools.push({
              type: 'web_search', search_context_size: plan.complexity === 'high' ? 'high' : 'medium',
            })
            return await requestOpenAiResponse(String(openAiApiKey), {
              model: activeModel, instructions: prompt.prompt_text,
              input: mustSynthesize
                ? [...cleanProviderItemsForOpenAi(runItems), { role: 'developer', content: finalInstruction }]
                : cleanProviderItemsForOpenAi(runItems),
              tools, tool_choice: allowSynthesisTools && tools.length ? 'auto' : 'none', parallel_tool_calls: false,
"""
if old_openai not in core:
    raise SystemExit('OpenAI synthesis block not found')
core = core.replace(old_openai, new_openai, 1)
core_path.write_text(core)

scenario_path = Path('src/evaluation/reasoningGoldenScenarios.ts')
scenarios = scenario_path.read_text()
old_simple = """const lowSimple = (): ReasoningGoldenRuntimeExpectation => ({
  requiredStages: ['routing', 'answering'],
  forbiddenStages: ['searching_web'],
  minimumToolCalls: 0,
});
"""
new_simple = """const lowSimple = (): ReasoningGoldenRuntimeExpectation => ({
  requiredStages: ['routing', 'answering'],
  forbiddenStages: ['searching_knowledge', 'searching_web', 'verifying'],
  minimumKnowledgeSources: 0,
  minimumWebSources: 0,
  minimumToolCalls: 0,
});
"""
if old_simple not in scenarios:
    raise SystemExit('lowSimple contract block not found')
scenario_path.write_text(scenarios.replace(old_simple, new_simple, 1))
