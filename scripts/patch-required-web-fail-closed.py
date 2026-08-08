from pathlib import Path

path = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
text = path.read_text()

old = """      const collectWeb = async (query: string, plan: ReasoningPlan, phase: string) => {
        if (!openAiApiKey || totalToolCalls >= MAX_TOOL_CALLS) return
        totalToolCalls += 1
        const startedAt = performance.now()
        try {
          const result = await withTimeout(runRequiredWebResearch({
            apiKey: openAiApiKey, model: promptModel, query, complexity: plan.complexity, signal: runController.signal,
          }), 30_000, 'web_search')
          usage = addUsage(usage, result.usage); webUsed = result.searchCount > 0
          if (result.text) evidence.push(`[TOOL:web_search]\\n${result.text}`)
          sources = uniqueSources([...sources, ...result.sources])
          await logToolRun(adminClient, {
            conversationId: conversation.id, turnId, workspaceId, ownerId: authData.user.id,
            promptVersionId: prompt.id, toolName: 'web_search', callId: `${phase}:web:${crypto.randomUUID()}`,
            arguments: { query }, resultSummary: { searchCount: result.searchCount, sourceCount: result.sources.length, engine: ENGINE_VERSION, deterministic: true },
            sourceRefs: result.sources, status: 'completed', durationMs: Math.round(performance.now() - startedAt),
          })
        } catch (webError) {
          await logToolRun(adminClient, {
            conversationId: conversation.id, turnId, workspaceId, ownerId: authData.user.id,
            promptVersionId: prompt.id, toolName: 'web_search', callId: `${phase}:web:${crypto.randomUUID()}`,
            arguments: { query }, resultSummary: { engine: ENGINE_VERSION, deterministic: true }, sourceRefs: [], status: 'failed',
            durationMs: Math.round(performance.now() - startedAt), errorMessage: errorMessage(webError),
          })
          evidence.push(`[TOOL:web_search ERROR]\\n${errorMessage(webError).slice(0, 1_000)}`)
        }
      }
"""

new = """      const collectWeb = async (query: string, plan: ReasoningPlan, phase: string) => {
        const required = plan.webMode === 'required'
        if (!openAiApiKey) {
          if (required) throw new Error('Required web research is unavailable because OPENAI_API_KEY is not configured.')
          return false
        }
        if (totalToolCalls >= MAX_TOOL_CALLS) {
          if (required) throw new Error('Required web research could not run because the safe tool-call budget was exhausted.')
          return false
        }
        totalToolCalls += 1
        const startedAt = performance.now()
        try {
          const result = await withTimeout(runRequiredWebResearch({
            apiKey: openAiApiKey, model: promptModel, query, complexity: plan.complexity, signal: runController.signal,
          }), 30_000, 'web_search')
          usage = addUsage(usage, result.usage); webUsed = result.searchCount > 0
          if (result.text) evidence.push(`[TOOL:web_search]\\n${result.text}`)
          sources = uniqueSources([...sources, ...result.sources])
          const hasVerifiableWebEvidence = result.searchCount > 0 && result.sources.some(
            source => source.sourceType === 'web' && /^https?:\\/\\//i.test(String(source.url || '')),
          )
          await logToolRun(adminClient, {
            conversationId: conversation.id, turnId, workspaceId, ownerId: authData.user.id,
            promptVersionId: prompt.id, toolName: 'web_search', callId: `${phase}:web:${crypto.randomUUID()}`,
            arguments: { query },
            resultSummary: { searchCount: result.searchCount, sourceCount: result.sources.length, hasVerifiableWebEvidence, engine: ENGINE_VERSION, deterministic: true },
            sourceRefs: result.sources,
            status: hasVerifiableWebEvidence || !required ? 'completed' : 'failed',
            durationMs: Math.round(performance.now() - startedAt),
            errorMessage: hasVerifiableWebEvidence || !required ? undefined : 'Required web research returned no verifiable URL sources.',
          })
          if (required && !hasVerifiableWebEvidence) {
            throw new Error('Required web research returned no verifiable URL sources.')
          }
          return hasVerifiableWebEvidence
        } catch (webError) {
          if (!/Required web research returned no verifiable URL sources/i.test(errorMessage(webError))) {
            await logToolRun(adminClient, {
              conversationId: conversation.id, turnId, workspaceId, ownerId: authData.user.id,
              promptVersionId: prompt.id, toolName: 'web_search', callId: `${phase}:web:${crypto.randomUUID()}`,
              arguments: { query }, resultSummary: { engine: ENGINE_VERSION, deterministic: true }, sourceRefs: [], status: 'failed',
              durationMs: Math.round(performance.now() - startedAt), errorMessage: errorMessage(webError),
            })
          }
          evidence.push(`[TOOL:web_search ERROR]\\n${errorMessage(webError).slice(0, 1_000)}`)
          if (required) throw webError
          return false
        }
      }
"""

if old not in text:
    raise SystemExit('Expected collectWeb block not found')
path.write_text(text.replace(old, new, 1))
