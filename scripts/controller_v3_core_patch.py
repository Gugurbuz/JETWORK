from pathlib import Path

path = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
"""  cleanProviderItemsForOpenAi,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  OPENAI_MODELS,
  providerForModel,
  requestGeminiResponse,
  type AssistantProvider,
""",
"""  cleanProviderItemsForOpenAi,
  createGeminiProviderStateItem,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  OPENAI_MODELS,
  providerForModel,
  requestGeminiResponse,
  type AssistantProvider,
""",
'import provider-state helper',
)

replace_once(
"""const geminiWebSearchQueries = (response: Record<string, unknown>): string[] => (
  Array.isArray(response.webSearchQueries)
    ? [...new Set(response.webSearchQueries.map(query => String(query || '').trim()).filter(Boolean))].slice(0, 12)
    : []
)

serve(async req => {
""",
"""const geminiWebSearchQueries = (response: Record<string, unknown>): string[] => (
  Array.isArray(response.webSearchQueries)
    ? [...new Set(response.webSearchQueries.map(query => String(query || '').trim()).filter(Boolean))].slice(0, 12)
    : []
)

const knowledgeToolNames = new Set((ASSISTANT_KNOWLEDGE_TOOLS as readonly { name: string }[]).map(tool => tool.name))

const publicGeminiStepActivity = (stepType: string) => {
  if (stepType === 'google_search_call') return {
    tool: 'Web', sourceType: 'web', startLabel: 'Web kaynakları aranıyor...', completedLabel: 'Web kaynakları tarandı',
  }
  if (stepType === 'url_context_call') return {
    tool: 'Web', sourceType: 'web', startLabel: 'Web sayfaları inceleniyor...', completedLabel: 'Web sayfaları incelendi',
  }
  if (stepType === 'code_execution_call') return {
    tool: 'Kod Çalıştırma', sourceType: 'runtime', startLabel: 'Kod çalıştırılıyor...', completedLabel: 'Kod çalıştırıldı',
  }
  return null
}

const publicCustomToolActivity = (toolName: string) => {
  if (knowledgeToolNames.has(toolName)) return {
    tool: 'Bilgi Bankası', sourceType: 'knowledge', startLabel: 'Bilgi bankası sorgusu çalışıyor...', completedLabel: 'Bilgi bankası sorgusu tamamlandı',
  }
  if (isSkillTool(toolName)) return {
    tool: 'Çalışma Yöntemi', sourceType: 'runtime', startLabel: 'Çalışma yöntemi hazırlanıyor...', completedLabel: 'Çalışma yöntemi hazırlandı',
  }
  if (/document|artifact|spreadsheet|file/i.test(toolName)) return {
    tool: 'Dosya', sourceType: 'artifact', startLabel: 'Çalışma çıktısı hazırlanıyor...', completedLabel: 'Çalışma çıktısı hazırlandı',
  }
  if (toolName === 'review_evidence_coverage') return {
    tool: 'Kanıt Kontrolü', sourceType: 'runtime', startLabel: 'Kanıt kapsamı inceleniyor...', completedLabel: 'Kanıt kapsamı incelendi',
  }
  if (toolName === 'record_project_memory') return {
    tool: 'Proje Bağlamı', sourceType: 'runtime', startLabel: 'Proje bağlamı kaydediliyor...', completedLabel: 'Proje bağlamı kaydedildi',
  }
  return {
    tool: 'JETWORK', sourceType: 'runtime', startLabel: 'JETWORK aracı çalışıyor...', completedLabel: 'JETWORK aracı tamamlandı',
  }
}

serve(async req => {
""",
'public operation descriptors',
)

replace_once(
"""      let providerFallbackUsed = false
      let reasoningFallbackUsed = false
      let reasoningRunId: string | null = null
""",
"""      let providerFallbackUsed = false
      let reasoningFallbackUsed = false
      let latestGeminiInteractionId: string | null = null
      let reasoningRunId: string | null = null
""",
'latest Gemini interaction state',
)

replace_once(
"""        emitStatus('synthesizing', AGENTIC_CONTROLLER_ENABLED
          ? 'Controller ilk aksiyonu değerlendiriyor...'
          : 'Kanıtlar ve doğrulama sonucu sentezleniyor...')
""",
"""        if (!AGENTIC_CONTROLLER_ENABLED) {
          emitStatus('synthesizing', 'Kanıtlar ve doğrulama sonucu sentezleniyor...')
        }
""",
'suppress synthetic controller-start status',
)

replace_once(
"""                onText: delta => {
                  roundText += delta
                  if (canLiveStreamProviderText && delta) {
                    if (!answerStreamingStatusEmitted) {
                      answerStreamingStatusEmitted = true
                      emitStatus('answering', 'Yanıt oluşturuluyor...')
                    }
                    roundTextStreamed = true
                    sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta })
                  }
                },
                signal: runController.signal,
""",
"""                onText: delta => {
                  roundText += delta
                  if (canLiveStreamProviderText && delta) {
                    if (!answerStreamingStatusEmitted) {
                      answerStreamingStatusEmitted = true
                      emitStatus('answering', 'Yanıt oluşturuluyor...')
                    }
                    roundTextStreamed = true
                    sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta })
                  }
                },
                onStepEvent: step => {
                  const activity = publicGeminiStepActivity(step.stepType)
                  if (!activity) return
                  sendEvent(controller, encoder, 'provider_step', {
                    type: 'provider_step',
                    provider: 'gemini',
                    operation_id: `gemini:${step.operationId}`,
                    lifecycle: step.lifecycle,
                    label: step.lifecycle === 'start' ? activity.startLabel : activity.completedLabel,
                    tool: activity.tool,
                    source_type: activity.sourceType,
                    failed: step.failed === true,
                  })
                },
                signal: runController.signal,
""",
'wire provider step events',
)

replace_once(
"""          usage = addUsage(usage, response.usage); responseModel = response.model || responseModel
          const output = response.output || []
""",
"""          usage = addUsage(usage, response.usage)
          responseModel = response.model || responseModel
          if (activeProvider === 'gemini') {
            const interactionId = cleanString(response.id, 500)
            if (interactionId) latestGeminiInteractionId = interactionId
          }
          const output = response.output || []
""",
'capture interaction id',
)

replace_once(
"""              emitStatus('searching_web', `${finalWebSources.length} web kaynağı toplandı`)
              if (!AGENTIC_CONTROLLER_ENABLED && plan.verificationRequired) emitStatus('verifying', 'Google grounding kaynakları yanıtla eşleştirildi')
""",
"""              if (!AGENTIC_CONTROLLER_ENABLED) emitStatus('searching_web', `${finalWebSources.length} web kaynağı toplandı`)
              if (!AGENTIC_CONTROLLER_ENABLED && plan.verificationRequired) emitStatus('verifying', 'Google grounding kaynakları yanıtla eşleştirildi')
""",
'suppress duplicate native-web status',
)

replace_once(
"""            const groundingCoverage = evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
            if (shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })) {
""",
"""            const groundingCoverage = evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
            const groundingBlocked = shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })
            if (groundingBlocked) {
""",
'grounding blocked flag',
)

replace_once(
"""              emitStatus('verifying', 'Kanıt kapsamı dışında kalan teknik iddialar engellendi')
            }
            const stateItems = compactConversationState([...baseItems, { role: 'assistant', content: roundText }], plan)
            const { error: completionError } = await adminClient.rpc('complete_assistant_turn', {
""",
"""              emitStatus('verifying', 'Kanıt kapsamı dışında kalan teknik iddialar engellendi')
            }
            const persistedTurnItems: Array<Record<string, unknown>> = [...baseItems, { role: 'assistant', content: roundText }]
            if (activeProvider === 'gemini' && latestGeminiInteractionId && !groundingBlocked) {
              persistedTurnItems.push(createGeminiProviderStateItem(latestGeminiInteractionId))
              usage = addUsage(usage, { gemini_interaction_state_persisted: 1 })
            } else if (activeProvider === 'gemini' && groundingBlocked) {
              usage = addUsage(usage, { gemini_interaction_state_discarded_grounding: 1 })
            }
            const stateItems = compactConversationState(persistedTurnItems, plan)
            const { error: completionError } = await adminClient.rpc('complete_assistant_turn', {
""",
'persist validated interaction state only',
)

replace_once(
"""          const hasSkillCalls = functionCalls.some((call: Record<string, unknown>) => isSkillTool(cleanString(call.name, 120)))
          const hasDiscoveryCalls = functionCalls.some((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
          emitStatus('synthesizing', hasDiscoveryCalls
            ? 'Controller ek semantic capability adayları istiyor...'
            : hasSkillCalls
              ? 'Controller ilgili JetWork skill prosedürlerini yüklüyor...'
              : 'Controller ek capability/kanıt çağrısı yapıyor...')
""",
"""          if (!AGENTIC_CONTROLLER_ENABLED) {
            const hasSkillCalls = functionCalls.some((call: Record<string, unknown>) => isSkillTool(cleanString(call.name, 120)))
            const hasDiscoveryCalls = functionCalls.some((call: Record<string, unknown>) => cleanString(call.name, 120) === DISCOVER_MORE_CAPABILITIES_TOOL_NAME)
            emitStatus('synthesizing', hasDiscoveryCalls
              ? 'Controller ek semantic capability adayları istiyor...'
              : hasSkillCalls
                ? 'Controller ilgili JetWork skill prosedürlerini yüklüyor...'
                : 'Controller ek capability/kanıt çağrısı yapıyor...')
          }
""",
'suppress synthetic between-tool status',
)

replace_once(
"""            try {
              const result = isSkillTool(toolName)
                ? await runSkillTool(toolName, args, 'model:skill')
                : await runKnowledgeTool(toolName, args, 'model:capability')
              runItems.push({ type: 'function_call_output', call_id: callId, output: result.output })
            } catch (toolError) {
              runItems.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify({ error: 'TOOL_EXECUTION_FAILED', message: errorMessage(toolError).slice(0, 1_000) }) })
            }
""",
"""            const customActivity = publicCustomToolActivity(toolName)
            const customOperationId = `custom:${callId || crypto.randomUUID()}`
            sendEvent(controller, encoder, 'provider_step', {
              type: 'provider_step', operation_id: customOperationId, lifecycle: 'start',
              label: customActivity.startLabel, tool: customActivity.tool, source_type: customActivity.sourceType,
            })
            try {
              const result = isSkillTool(toolName)
                ? await runSkillTool(toolName, args, 'model:skill')
                : await runKnowledgeTool(toolName, args, 'model:capability')
              runItems.push({ type: 'function_call_output', call_id: callId, output: result.output })
              sendEvent(controller, encoder, 'provider_step', {
                type: 'provider_step', operation_id: customOperationId, lifecycle: 'complete',
                label: customActivity.completedLabel, tool: customActivity.tool, source_type: customActivity.sourceType,
              })
            } catch (toolError) {
              runItems.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify({ error: 'TOOL_EXECUTION_FAILED', message: errorMessage(toolError).slice(0, 1_000) }) })
              sendEvent(controller, encoder, 'provider_step', {
                type: 'provider_step', operation_id: customOperationId, lifecycle: 'complete', failed: true,
                label: `${customActivity.tool} işlemi tamamlanamadı`, tool: customActivity.tool, source_type: customActivity.sourceType,
              })
            }
""",
'custom tool lifecycle events',
)

path.write_text(text, encoding='utf-8')
print('controller-v3 core patch applied')
