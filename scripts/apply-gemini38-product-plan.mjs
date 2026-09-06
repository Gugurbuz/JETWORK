import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const write = (path, content) => fs.writeFileSync(path, content)
const replace = (path, search, replacement, label = String(search).slice(0, 80)) => {
  const source = read(path)
  if (!source.includes(search)) throw new Error(`${path}: missing replacement target: ${label}`)
  write(path, source.replace(search, replacement))
}
const replaceRegex = (path, regex, replacement, label) => {
  const source = read(path)
  if (!regex.test(source)) throw new Error(`${path}: missing regex target: ${label}`)
  write(path, source.replace(regex, replacement))
}

// G5 — Gemini 3.8 is the semantic authority. Keep the old deterministic
// research executor file for rollback/history, but remove it from the active
// provider path.
replace('supabase/functions/_shared/modelProviders.ts',
  "import { runDeterministicGeminiWebResearch } from './deterministicGeminiWebResearch.ts'\n",
  '',
  'deterministic web import')
replace('supabase/functions/_shared/modelProviders.ts',
  "  allowProviderWeb?: boolean\n  maxOutputTokens: number",
  "  allowProviderWeb?: boolean\n  workMode?: 'fast' | 'balanced' | 'deep'\n  maxOutputTokens: number",
  'GeminiRequestInput workMode')
replaceRegex('supabase/functions/_shared/modelProviders.ts',
  /export async function requestGeminiResponse\(input: GeminiRequestInput\): Promise<NormalizedModelResponse> \{[\s\S]*?\n\}\s*$/,
  `export async function requestGeminiResponse(input: GeminiRequestInput): Promise<NormalizedModelResponse> {\n  // Provider-native web is exposed as a capability. The active Gemini controller\n  // decides whether to use Google Search; no semantic intent gate executes web first.\n  return requestBaseWithEmptyFinalizationRecovery(input, extractSemanticPlanFromItems(input.items))\n}\n`,
  'active deterministic deep research wrapper')

// G2 — carry an explicit user work mode to the provider. Balanced is MEDIUM.
replace('supabase/functions/_shared/modelProvidersBase.ts',
  "  allowProviderWeb?: boolean\n  maxOutputTokens: number",
  "  allowProviderWeb?: boolean\n  workMode?: 'fast' | 'balanced' | 'deep'\n  maxOutputTokens: number",
  'base provider workMode')

replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  "import { GoogleGenAI } from 'npm:@google/genai@2.21.0'\n",
  "import { GoogleGenAI } from 'npm:@google/genai@2.21.0'\nimport { normalizeGeminiFunctionCalls } from './geminiFunctionContract.ts'\n",
  'function contract import')
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  "  allowTools: boolean\n  maxOutputTokens: number",
  "  allowTools: boolean\n  workMode?: 'fast' | 'balanced' | 'deep'\n  maxOutputTokens: number",
  'legacy provider workMode')
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  `  if (artifactSynthesis) {\n    config.thinkingConfig = { thinkingLevel: 'low' }\n  } else if (finalSynthesis && executionModel === DEFAULT_GEMINI_MODEL) {\n    config.thinkingConfig = { thinkingLevel: 'medium' }\n  }`,
  `  const selectedThinkingLevel = input.workMode === 'fast'\n    ? 'low'\n    : input.workMode === 'deep'\n      ? 'high'\n      : 'medium'\n  if (artifactSynthesis) {\n    config.thinkingConfig = { thinkingLevel: 'low' }\n  } else if (executionModel === DEFAULT_GEMINI_MODEL) {\n    // The controller starts at MEDIUM unless the user explicitly selected Fast/Deep.\n    // Runtime never infers this from task keywords or intent labels.\n    config.thinkingConfig = { thinkingLevel: selectedThinkingLevel }\n  }`,
  'thinking policy')
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  `  const functionCalls = parts.filter((part: any) => part?.functionCall)\n  const output = functionCalls.length\n    ? functionCalls.map((part: any, index: number) => {\n        const call = part.functionCall || {}\n        return { type: 'function_call', call_id: String(call.id || crypto.randomUUID()), name: String(call.name || ''), arguments: JSON.stringify(call.args || {}), _geminiContent: index === 0 ? candidateContent : undefined, _geminiSkipContent: index > 0 }\n      })`,
  `  const functionCalls = normalizeGeminiFunctionCalls(parts)\n  const output = functionCalls.length\n    ? functionCalls.map((call, index) => ({\n        type: 'function_call',\n        call_id: call.id,\n        name: call.name,\n        arguments: JSON.stringify(call.args),\n        _geminiContent: index === 0 ? candidateContent : undefined,\n        _geminiSkipContent: index > 0,\n      }))`,
  'strict function call normalization')
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  `      reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),\n      total_tokens: Number(metadata.totalTokenCount || 0),`,
  `      reasoning_tokens: Number(metadata.thoughtsTokenCount || 0),\n      cached_tokens: Number(metadata.cachedContentTokenCount || metadata.totalCachedTokens || 0),\n      gemini_implicit_cache_hit: Number(metadata.cachedContentTokenCount || metadata.totalCachedTokens || 0) > 0 ? 1 : 0,\n      total_tokens: Number(metadata.totalTokenCount || 0),`,
  'implicit cache telemetry')

// Preserve multimodal parts when manually circulating Gemini history.
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  `const parseToolOutput = (value: unknown): unknown => {\n  if (typeof value !== 'string') return value\n  try { return JSON.parse(value) } catch { return value }\n}\n\nconst toGeminiContents`,
  `const parseToolOutput = (value: unknown): unknown => {\n  if (typeof value !== 'string') return value\n  try { return JSON.parse(value) } catch { return value }\n}\n\nconst contentPartsForGemini = (content: unknown): Array<Record<string, unknown>> => {\n  if (typeof content === 'string') return content ? [{ text: content }] : []\n  if (!Array.isArray(content)) return []\n  return content.flatMap(part => {\n    if (typeof part === 'string') return part ? [{ text: part }] : []\n    if (!part || typeof part !== 'object') return []\n    const candidate = part as Record<string, unknown>\n    if (typeof candidate.text === 'string' && candidate.text) return [{ text: candidate.text }]\n    const inlineData = candidate.inlineData && typeof candidate.inlineData === 'object'\n      ? candidate.inlineData as Record<string, unknown>\n      : null\n    if (inlineData && typeof inlineData.mimeType === 'string' && typeof inlineData.data === 'string') {\n      return [{ inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } }]\n    }\n    return []\n  })\n}\n\nconst toGeminiContents`,
  'multimodal parts helper')
replace('supabase/functions/_shared/modelProvidersLegacy.ts',
  `    if ((role === 'user' || role === 'assistant') && !type) {\n      const text = textFromContent(item.content)\n      if (text) contents.push({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] })\n      continue\n    }\n    if (type === 'message') {\n      const text = textFromContent(item.content)\n      if (text) contents.push({ role: role === 'user' ? 'user' : 'model', parts: [{ text }] })\n      continue\n    }`,
  `    if ((role === 'user' || role === 'assistant') && !type) {\n      const parts = contentPartsForGemini(item.content)\n      if (parts.length) contents.push({ role: role === 'assistant' ? 'model' : 'user', parts })\n      continue\n    }\n    if (type === 'message') {\n      const parts = contentPartsForGemini(item.content)\n      if (parts.length) contents.push({ role: role === 'user' ? 'user' : 'model', parts })\n      continue\n    }`,
  'preserve multimodal history')

// G0 — production 2026 Gemini 3.8 pricing in shared cost telemetry.
replace('supabase/functions/_shared/geminiCostGuard.ts',
  "  'gemini-3.5-flash': { input: 1.5, output: 9 },",
  "  'gemini-3.5-flash': { input: 1.5, output: 9 },\n  'gemini-3.8-flash': { input: 0.75, output: 3.75 },",
  'Gemini 3.8 pricing')

// G7 — a thin public-progress tool. It has no data access and no semantic authority.
replace('supabase/functions/_shared/capabilities/controllerSurface.ts',
  "export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'\n",
  "export const DISCOVER_MORE_CAPABILITIES_TOOL_NAME = 'discover_more_capabilities'\nexport const REPORT_PROGRESS_TOOL_NAME = 'report_progress'\n",
  'report progress name')
replace('supabase/functions/_shared/capabilities/controllerSurface.ts',
  `export const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {`,
  `export const REPORT_PROGRESS_TOOL: RuntimeToolSchema = {\n  type: 'function',\n  name: REPORT_PROGRESS_TOOL_NAME,\n  description: 'Publish a short user-visible work update when there is a meaningful start, finding, plan change or blocker. This tool only emits a public commentary event; it cannot retrieve data, grant permission, execute external actions or decide the next capability.',\n  strict: true,\n  parameters: {\n    type: 'object',\n    properties: {\n      kind: { type: 'string', enum: ['start', 'finding', 'plan_change', 'blocked'] },\n      message: { type: 'string', minLength: 2, maxLength: 500 },\n      sourceRefs: { type: ['array', 'null'], items: { type: 'string', maxLength: 500 }, maxItems: 8 },\n    },\n    required: ['kind', 'message', 'sourceRefs'],\n    additionalProperties: false,\n  },\n}\n\nexport const DISCOVER_MORE_CAPABILITIES_TOOL: RuntimeToolSchema = {`,
  'report progress schema')
replace('supabase/functions/_shared/capabilities/controllerSurface.ts',
  `  selectedTools.push(DISCOVER_MORE_CAPABILITIES_TOOL)`,
  `  selectedTools.push(DISCOVER_MORE_CAPABILITIES_TOOL)\n  selectedTools.push(REPORT_PROGRESS_TOOL)`,
  'always visible report progress')

replace('supabase/functions/_shared/agent/controllerPolicy.ts',
  `  'Gizli düşünce zincirini kullanıcıya açıklama. Kullanıcıya sonuç, doğrulanmış dayanaklar, önemli çıkarımlar, belirsizlikler ve gerekiyorsa sonraki aksiyonu ver.',`,
  `  'Uzun veya araç kullanan işlerde kullanıcı açısından anlamlı bir başlangıç, yeni bulgu, plan değişikliği veya engel oluştuğunda report_progress ile 1-3 kısa cümlelik public çalışma güncellemesi paylaş. Her tool çağrısında mesaj atma; ham reasoning, thought signature, secret veya başka tenant bilgisi paylaşma. Basit tek-adımlı cevaplarda report_progress kullanma.',\n  'Gizli düşünce zincirini kullanıcıya açıklama. Kullanıcıya sonuç, doğrulanmış dayanaklar, önemli çıkarımlar, belirsizlikler ve gerekiyorsa sonraki aksiyonu ver.',`,
  'controller progress policy')

// G2/G4 — client settings and request transport.
replace('src/store/useSettingsStore.ts',
  `export type ThemeType = 'monochrome' | 'energetic' | 'ocean';\n`,
  `export type ThemeType = 'monochrome' | 'energetic' | 'ocean';\nexport type WorkMode = 'fast' | 'balanced' | 'deep';\n`)
replace('src/store/useSettingsStore.ts',
  `  selectedModel: string;\n  setSelectedModel: (model: string) => void;`,
  `  selectedModel: string;\n  setSelectedModel: (model: string) => void;\n  workMode: WorkMode;\n  setWorkMode: (mode: WorkMode) => void;`)
replace('src/store/useSettingsStore.ts',
  `  setSelectedModel: (model) => {\n    const normalizedModel = normalizeSelectableModel(model);\n    writeLocalSetting('selected_model', normalizedModel);\n    set({ selectedModel: normalizedModel });\n  },\n  theme:`,
  `  setSelectedModel: (model) => {\n    const normalizedModel = normalizeSelectableModel(model);\n    writeLocalSetting('selected_model', normalizedModel);\n    set({ selectedModel: normalizedModel });\n  },\n  workMode: (readLocalSetting('assistant_work_mode') as WorkMode) || 'balanced',\n  setWorkMode: (workMode) => {\n    writeLocalSetting('assistant_work_mode', workMode);\n    set({ workMode });\n  },\n  theme:`)

replace('src/services/assistantRuntimeClient.ts',
  `export interface AssistantChatAttachment {\n  name: string;\n  mimeType: string;\n  content: string;\n}`,
  `export interface AssistantChatAttachment {\n  name: string;\n  mimeType: string;\n  content: string;\n  encoding?: 'utf8' | 'base64';\n}`)
replace('src/services/assistantRuntimeClient.ts',
  `  | { type: 'status'; stage: AssistantRuntimeStage; label?: string }\n  | {`,
  `  | { type: 'status'; stage: AssistantRuntimeStage; label?: string }\n  | { type: 'commentary'; sequence: number; kind: 'start' | 'finding' | 'plan_change' | 'blocked'; message: string; sourceRefs: string[] }\n  | {`)
replace('src/services/assistantRuntimeClient.ts',
  `  if (eventType === 'completed') {`,
  `  if (eventType === 'commentary') {\n    const kind = ['start', 'finding', 'plan_change', 'blocked'].includes(String(payload.kind))\n      ? String(payload.kind) as 'start' | 'finding' | 'plan_change' | 'blocked'\n      : 'finding';\n    return {\n      type: 'commentary',\n      sequence: Math.max(1, Number(payload.sequence || 1)),\n      kind,\n      message: String(payload.message || '').trim().slice(0, 500),\n      sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs.map(value => String(value)).slice(0, 8) : [],\n    };\n  }\n  if (eventType === 'completed') {`)
replace('src/services/assistantRuntimeClient.ts',
  `  model?: string;\n  chatAttachments?: AssistantChatAttachment[];`,
  `  model?: string;\n  workMode?: 'fast' | 'balanced' | 'deep';\n  chatAttachments?: AssistantChatAttachment[];`)
replace('src/services/assistantRuntimeClient.ts',
  `  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;\n}): Promise<AssistantRuntimeResult>`,
  `  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;\n  onCommentary?: (event: { sequence: number; kind: 'start' | 'finding' | 'plan_change' | 'blocked'; message: string; sourceRefs: string[] }) => void;\n}): Promise<AssistantRuntimeResult>`)
replace('src/services/assistantRuntimeClient.ts',
  `      model: input.model || 'auto',\n      chatAttachments: input.chatAttachments || [],`,
  `      model: input.model || 'auto',\n      workMode: input.workMode || 'balanced',\n      chatAttachments: input.chatAttachments || [],`)
replace('src/services/assistantRuntimeClient.ts',
  `      if (parsed.type === 'status') {`,
  `      if (parsed.type === 'commentary') {\n        if (parsed.message) input.onCommentary?.(parsed);\n        return;\n      }\n      if (parsed.type === 'status') {`)

// Replace attachment preparation with text + image/PDF base64 support.
replaceRegex('src/services/assistantRuntimeClient.ts',
  /export async function prepareAssistantChatAttachments\([\s\S]*?\n\}\n\nexport function parseAssistantRuntimeEvent/,
  `const MULTIMODAL_CHAT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);\nconst MAX_CHAT_MEDIA_BYTES = 6 * 1024 * 1024;\n\nconst bytesToBase64 = (bytes: Uint8Array): string => {\n  let binary = '';\n  const chunkSize = 0x8000;\n  for (let offset = 0; offset < bytes.length; offset += chunkSize) {\n    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));\n  }\n  return btoa(binary);\n};\n\nconst readAttachmentBytes = async (attachment: MessageAttachment): Promise<Uint8Array> => {\n  if (attachment.data) {\n    const encoded = attachment.data.includes(',') ? attachment.data.slice(attachment.data.indexOf(',') + 1) : attachment.data;\n    return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));\n  }\n  if (attachment.file) return new Uint8Array(await attachment.file.arrayBuffer());\n  throw new Error(\`${'${attachment.name || \'Dosya\'}'} içeriği artık mevcut değil; dosyayı yeniden ekleyin.\`);\n};\n\nexport async function prepareAssistantChatAttachments(\n  attachments: MessageAttachment[] = [],\n): Promise<AssistantChatAttachment[]> {\n  const chatAttachments = attachments.filter(candidate => candidate.purpose === 'chat_only');\n  if (chatAttachments.length > MAX_CHAT_ATTACHMENTS) {\n    throw new AssistantAttachmentValidationError(\`Bir mesajda en fazla ${'${MAX_CHAT_ATTACHMENTS}'} sohbet eki kullanılabilir.\`);\n  }\n\n  const prepared: AssistantChatAttachment[] = [];\n  let remainingCharacters = MAX_CHAT_ATTACHMENT_CHARACTERS;\n  let remainingMediaBytes = MAX_CHAT_MEDIA_BYTES;\n\n  for (const attachment of chatAttachments) {\n    const mimeType = String(attachment.mimeType || attachment.file?.type || 'application/octet-stream').toLocaleLowerCase('en-US');\n    if (MULTIMODAL_CHAT_MIMES.has(mimeType)) {\n      const bytes = await readAttachmentBytes(attachment);\n      if (bytes.byteLength > remainingMediaBytes) {\n        throw new AssistantAttachmentValidationError('Görsel/PDF sohbet ekleri toplam 6 MB sınırını aşamaz.');\n      }\n      prepared.push({\n        name: String(attachment.name || 'multimodal-input').slice(0, 240),\n        mimeType,\n        content: bytesToBase64(bytes),\n        encoding: 'base64',\n      });\n      remainingMediaBytes -= bytes.byteLength;\n      continue;\n    }\n\n    const content = (await readAttachmentText(attachment)).replace(/^\\uFEFF/, '').replace(/\\r\\n?/g, '\\n');\n    if (!content.trim()) continue;\n    if (content.length > remainingCharacters) {\n      throw new AssistantAttachmentValidationError(\`Sohbet eklerinin toplam metni ${'${MAX_CHAT_ATTACHMENT_CHARACTERS.toLocaleString(\'tr-TR\')}'} karakteri aşamaz.\`);\n    }\n    prepared.push({ name: String(attachment.name || 'sohbet-eki.txt').slice(0, 240), mimeType, content, encoding: 'utf8' });\n    remainingCharacters -= content.length;\n  }\n  return prepared;\n}\n\nexport function parseAssistantRuntimeEvent`,
  'multimodal chat attachment preparation')

// useMessages: snapshot work mode, pass it, and persist/display public commentary.
replace('src/hooks/useMessages.ts',
  `    const requestedModel = useSettingsStore.getState().selectedModel || 'auto';`,
  `    const requestedModel = useSettingsStore.getState().selectedModel || 'auto';\n    const requestedWorkMode = useSettingsStore.getState().workMode || 'balanced';`)
replace('src/hooks/useMessages.ts',
  `          model: requestedModel,\n          chatAttachments:`,
  `          model: requestedModel,\n          workMode: requestedWorkMode,\n          chatAttachments:`)
replace('src/hooks/useMessages.ts',
  `          onStatus: (stage, label) => {`,
  `          onCommentary: (event) => {\n            const commentaryId = \`commentary:${'${aiMsgId}'}:${'${event.sequence}'}\`;\n            const commentaryMessage: Message = {\n              id: commentaryId, role: 'model', text: event.message, senderName: 'JetWork AI', senderRole: 'Çalışma güncellemesi',\n              createdAt: aiCreatedAt + event.sequence, isTyping: false, phase: phaseForAssistantStage(event.kind === 'blocked' ? 'verifying' : 'planning'),\n              phaseLabel: undefined, persistenceStatus: 'pending',\n            };\n            setMessages(previous => {\n              if (previous.some(message => message.id === commentaryId)) return previous;\n              const finalIndex = previous.findIndex(message => message.id === aiMsgId);\n              if (finalIndex < 0) return [...previous, commentaryMessage];\n              return [...previous.slice(0, finalIndex), commentaryMessage, ...previous.slice(finalIndex)];\n            });\n            broadcastMessage(channelRef, 'new_message', { itemId: currentWorkspaceId, message: messageForRealtime(commentaryMessage) });\n            void saveAiMessage(currentWorkspaceId, user.uid, commentaryMessage).catch(error => {\n              console.warn('Assistant commentary could not be persisted:', error);\n            });\n          },\n          onStatus: (stage, label) => {`)

// Server request parsing: work mode, multimodal payload and public commentary tool.
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,\n  startControllerCapabilitySession,`,
  `  DISCOVER_MORE_CAPABILITIES_TOOL_NAME,\n  REPORT_PROGRESS_TOOL_NAME,\n  startControllerCapabilitySession,`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000\nconst STREAM_HEARTBEAT_MS`,
  `const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000\nconst MAX_CHAT_MEDIA_BASE64_CHARACTERS = 8_500_000\nconst STREAM_HEARTBEAT_MS`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `    const requestedModel = cleanString(body?.model || AUTO_MODEL, 80)\n    const chatAttachments: Array<{ name: string; mimeType: string; content: string }> = []\n    let remainingAttachmentCharacters = MAX_CHAT_ATTACHMENT_CHARACTERS`,
  `    const requestedModel = cleanString(body?.model || AUTO_MODEL, 80)\n    const workMode = ['fast', 'balanced', 'deep'].includes(String(body?.workMode)) ? String(body.workMode) as 'fast' | 'balanced' | 'deep' : 'balanced'\n    const chatAttachments: Array<{ name: string; mimeType: string; content: string; encoding: 'utf8' | 'base64' }> = []\n    let remainingAttachmentCharacters = MAX_CHAT_ATTACHMENT_CHARACTERS\n    let remainingMediaCharacters = MAX_CHAT_MEDIA_BASE64_CHARACTERS`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `        if (!candidate || typeof candidate !== 'object' || remainingAttachmentCharacters <= 0) continue\n        const content = cleanString(candidate.content, remainingAttachmentCharacters)\n        if (!content) continue\n        chatAttachments.push({\n          name: cleanString(candidate.name || 'chat-attachment.txt', 240),\n          mimeType: cleanString(candidate.mimeType || 'text/plain', 120), content,\n        })\n        remainingAttachmentCharacters -= content.length`,
  `        if (!candidate || typeof candidate !== 'object') continue\n        const mimeType = cleanString(candidate.mimeType || 'text/plain', 120).toLocaleLowerCase('en-US')\n        const encoding = candidate.encoding === 'base64' ? 'base64' as const : 'utf8' as const\n        const maximum = encoding === 'base64' ? remainingMediaCharacters : remainingAttachmentCharacters\n        if (maximum <= 0) continue\n        const content = cleanString(candidate.content, maximum)\n        if (!content) continue\n        if (encoding === 'base64' && !['image/png','image/jpeg','image/webp','image/gif','application/pdf'].includes(mimeType)) {\n          return jsonResponse({ error: 'Unsupported multimodal chat MIME type.' }, 400)\n        }\n        chatAttachments.push({ name: cleanString(candidate.name || 'chat-attachment', 240), mimeType, content, encoding })\n        if (encoding === 'base64') remainingMediaCharacters -= content.length\n        else remainingAttachmentCharacters -= content.length`)
replaceRegex('supabase/functions/openai-assistant-core-v2/implementation.ts',
  /    const conversation = await getOrCreateConversation\([\s\S]*?    const requestHash = await sha256Text\(stableJson\(\{ message, chatAttachments, requestedModel, engine: ENGINE_VERSION \}\)\)/,
  `    const conversation = await getOrCreateConversation(adminClient, workspaceId, authData.user.id, prompt.id, configuredModel)\n    const currentUserParts: Array<Record<string, unknown>> = []\n    if (message) currentUserParts.push({ text: message })\n    chatAttachments.forEach((attachment, index) => {\n      const metadata = \`[UNTRUSTED_CHAT_ATTACHMENT_${'${index + 1}'}] ${'${JSON.stringify({ name: attachment.name, mimeType: attachment.mimeType })}'}\`;\n      if (attachment.encoding === 'base64') {\n        currentUserParts.push({ text: metadata })\n        currentUserParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.content } })\n        currentUserParts.push({ text: \`[END_UNTRUSTED_CHAT_ATTACHMENT_${'${index + 1}'}]\` })\n      } else {\n        currentUserParts.push({ text: [metadata, attachment.content, \`[END_UNTRUSTED_CHAT_ATTACHMENT_${'${index + 1}'}]\`].join('\\n') })\n      }\n    })\n    const currentUserContent: unknown = currentUserParts.length === 1 && typeof currentUserParts[0]?.text === 'string'\n      ? currentUserParts[0].text\n      : currentUserParts\n    const requestHash = await sha256Text(stableJson({ message, chatAttachments, requestedModel, workMode, engine: ENGINE_VERSION }))`,
  'server multimodal current user content')
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `    if (configuredProvider === 'gemini' && !geminiApiKey) return jsonResponse({ error: 'GEMINI_API_KEY is not configured for the selected model.' }, 503)`,
  `    if (configuredProvider === 'gemini' && !geminiApiKey) return jsonResponse({ error: 'GEMINI_API_KEY is not configured for the selected model.' }, 503)\n    if (chatAttachments.some(attachment => attachment.encoding === 'base64') && configuredProvider !== 'gemini') {\n      return jsonResponse({ error: 'Görsel/PDF sohbet girdisi şu anda Gemini 3.8 gerektiriyor.', code: 'MULTIMODAL_PROVIDER_REQUIRED' }, 400)\n    }`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `                allowProviderWeb: providerWebEnabled || geminiNativeWebPlanned,\n                maxOutputTokens: MAX_OUTPUT_TOKENS,`,
  `                allowProviderWeb: providerWebEnabled || geminiNativeWebPlanned,\n                workMode,\n                maxOutputTokens: MAX_OUTPUT_TOKENS,`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `      let capabilitySession: ControllerCapabilitySession | null = null\n      const trace: TraceEntry[] = []`,
  `      let capabilitySession: ControllerCapabilitySession | null = null\n      let commentarySequence = 0\n      const trace: TraceEntry[] = []`)
replace('supabase/functions/openai-assistant-core-v2/implementation.ts',
  `            if (toolName === DISCOVER_MORE_CAPABILITIES_TOOL_NAME) {`,
  `            if (toolName === REPORT_PROGRESS_TOOL_NAME) {\n              const kind = ['start', 'finding', 'plan_change', 'blocked'].includes(String(args.kind)) ? String(args.kind) : 'finding'\n              const publicMessage = cleanString(args.message, 500)\n              const sourceRefs = Array.isArray(args.sourceRefs) ? args.sourceRefs.map(value => cleanString(value, 500)).filter(Boolean).slice(0, 8) : []\n              if (!publicMessage) {\n                runItems.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify({ ok: false, error: 'Public progress message is empty.' }) })\n                continue\n              }\n              commentarySequence += 1\n              sendEvent(controller, encoder, 'commentary', { type: 'commentary', sequence: commentarySequence, kind, message: publicMessage, sourceRefs })\n              await logToolRun(adminClient, {\n                conversationId: conversation.id, turnId, workspaceId, ownerId: authData.user.id, promptVersionId: prompt.id,\n                toolName, callId, arguments: args, resultSummary: { engine: ENGINE_VERSION, publicCommentary: true, selectedByController: true },\n                sourceRefs: [], status: 'completed', durationMs: 0,\n              })\n              runItems.push({ type: 'function_call_output', call_id: callId, output: JSON.stringify({ ok: true, sequence: commentarySequence, kind }) })\n              continue\n            }\n            if (toolName === DISCOVER_MORE_CAPABILITIES_TOOL_NAME) {`)

// Root UI model control: add user-facing work mode choices in the same compact control.
const control = read('src/components/CompactModelControl.tsx')
const modeEnhanced = control
  .replace("import { PUBLIC_GEMINI_MODEL, useSettingsStore } from '../store/useSettingsStore';", "import { PUBLIC_GEMINI_MODEL, useSettingsStore, type WorkMode } from '../store/useSettingsStore';")
  .replace("const OPTIONS = [", "const WORK_MODES: Array<{ value: WorkMode; label: string; detail: string }> = [\n  { value: 'fast', label: 'Hızlı', detail: 'Daha düşük gecikme' },\n  { value: 'balanced', label: 'Dengeli', detail: 'Varsayılan kalite / hız dengesi' },\n  { value: 'deep', label: 'Derin', detail: 'Daha yoğun reasoning' },\n];\n\nconst OPTIONS = [")
  .replace("  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);", "  const setSelectedModel = useSettingsStore(state => state.setSelectedModel);\n  const workMode = useSettingsStore(state => state.workMode);\n  const setWorkMode = useSettingsStore(state => state.setWorkMode);")
  .replace("              <div role=\"menu\" className=\"space-y-0.5\">", "              <div className=\"px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted\">Çalışma modu</div>\n              <div role=\"menu\" className=\"space-y-0.5\">\n                {WORK_MODES.map(option => (\n                  <button key={option.value} type=\"button\" role=\"menuitemradio\" aria-checked={workMode === option.value} onClick={() => setWorkMode(option.value)} className=\"flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-theme-surface-hover\">\n                    <span className=\"min-w-0 flex-1\"><span className=\"block text-sm font-medium text-theme-text\">{option.label}</span><span className=\"mt-0.5 block text-[11px] text-theme-text-muted\">{option.detail}</span></span>\n                    {workMode === option.value && <Check size={16} className=\"shrink-0 text-theme-text\" />}\n                  </button>\n                ))}\n              </div>\n              <div className=\"my-1.5 border-t border-theme-border/60\" />\n              <div className=\"px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted\">Model</div>\n              <div role=\"menu\" className=\"space-y-0.5\">")
  .replace("      {open && (\n        <div role=\"menu\" className=\"absolute right-0 top-10 z-[70] w-64 rounded-xl border border-theme-border/70 bg-theme-bg p-1.5 shadow-xl\">", "      {open && (\n        <div role=\"menu\" className=\"absolute right-0 top-10 z-[70] w-72 rounded-xl border border-theme-border/70 bg-theme-bg p-1.5 shadow-xl\">\n          <div className=\"px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted\">Çalışma modu</div>\n          {WORK_MODES.map(option => (\n            <button key={option.value} type=\"button\" role=\"menuitemradio\" aria-checked={workMode === option.value} onClick={() => setWorkMode(option.value)} className=\"flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-theme-surface-hover\">\n              <span className=\"min-w-0 flex-1\"><span className=\"block text-xs font-medium text-theme-text\">{option.label}</span><span className=\"mt-0.5 block text-[10px] text-theme-text-muted\">{option.detail}</span></span>\n              {workMode === option.value && <Check size={14} className=\"shrink-0 text-theme-text\" />}\n            </button>\n          ))}\n          <div className=\"my-1.5 border-t border-theme-border/60\" />\n          <div className=\"px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted\">Model</div>")
if (modeEnhanced === control || !modeEnhanced.includes('WORK_MODES') || !modeEnhanced.includes('setWorkMode')) throw new Error('CompactModelControl work mode patch failed')
write('src/components/CompactModelControl.tsx', modeEnhanced)

// G0/G3/G5/G7/G4/G6 contract coverage.
write('supabase/functions/_shared/geminiFunctionContract.ts', `export interface NormalizedGeminiFunctionCall {\n  id: string\n  name: string\n  args: Record<string, unknown>\n}\n\nconst FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/\n\nexport const normalizeGeminiFunctionCalls = (parts: readonly unknown[]): NormalizedGeminiFunctionCall[] => {\n  const calls: NormalizedGeminiFunctionCall[] = []\n  const ids = new Set<string>()\n  for (const rawPart of parts) {\n    if (!rawPart || typeof rawPart !== 'object') continue\n    const functionCall = (rawPart as Record<string, unknown>).functionCall\n    if (!functionCall || typeof functionCall !== 'object') continue\n    const call = functionCall as Record<string, unknown>\n    const id = String(call.id || '').trim()\n    const name = String(call.name || '').trim()\n    if (!id) throw new Error('GEMINI_FUNCTION_CALL_ID_MISSING')\n    if (!FUNCTION_NAME.test(name)) throw new Error('GEMINI_FUNCTION_CALL_NAME_INVALID')\n    if (ids.has(id)) throw new Error('GEMINI_FUNCTION_CALL_ID_DUPLICATE')\n    ids.add(id)\n    const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args)\n      ? call.args as Record<string, unknown>\n      : {}\n    calls.push({ id, name, args })\n  }\n  return calls\n}\n`)

write('src/services/__tests__/gemini38ProductPlanCompletion.test.ts', `import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\nimport { normalizeGeminiFunctionCalls } from '../../../supabase/functions/_shared/geminiFunctionContract'\n\nconst provider = readFileSync(new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url), 'utf8')\nconst legacy = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url), 'utf8')\nconst core = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')\nconst surface = readFileSync(new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url), 'utf8')\nconst client = readFileSync(new URL('../assistantRuntimeClient.ts', import.meta.url), 'utf8')\nconst settings = readFileSync(new URL('../../store/useSettingsStore.ts', import.meta.url), 'utf8')\nconst cost = readFileSync(new URL('../../../supabase/functions/_shared/geminiCostGuard.ts', import.meta.url), 'utf8')\n\ndescribe('Gemini 3.8 product plan completion contracts', () => {\n  it('keeps web selection with the active controller instead of deterministic intent routing', () => {\n    expect(provider).not.toContain("import { runDeterministicGeminiWebResearch")\n    expect(provider).not.toContain("plan?.intent === 'research' && providerWebRequested")\n    expect(provider).toContain('requestBaseWithEmptyFinalizationRecovery')\n    expect(core).toContain('capabilitySession?.surface.providerWebVisible === true')\n  })\n\n  it('validates Gemini 3 function call ids and names without fabricating ids', () => {\n    expect(normalizeGeminiFunctionCalls([{ functionCall: { id: 'call_1', name: 'search_knowledge_catalog', args: { query: 'x' } } }]))\n      .toEqual([{ id: 'call_1', name: 'search_knowledge_catalog', args: { query: 'x' } }])\n    expect(() => normalizeGeminiFunctionCalls([{ functionCall: { name: 'x', args: {} } }])).toThrow('GEMINI_FUNCTION_CALL_ID_MISSING')\n    expect(legacy).not.toContain('call.id || crypto.randomUUID()')\n    expect(legacy).toContain('_geminiContent: index === 0 ? candidateContent')\n  })\n\n  it('has explicit Fast/Balanced/Deep policy without semantic keyword classification', () => {\n    expect(settings).toContain("export type WorkMode = 'fast' | 'balanced' | 'deep'")\n    expect(settings).toContain("assistant_work_mode")\n    expect(legacy).toContain("input.workMode === 'fast'")\n    expect(legacy).toContain("input.workMode === 'deep'")\n    expect(legacy).toContain("thinkingLevel: selectedThinkingLevel")\n  })\n\n  it('surfaces public commentary as a typed controller tool and SSE event', () => {\n    expect(surface).toContain("REPORT_PROGRESS_TOOL_NAME = 'report_progress'")\n    expect(surface).toContain("enum: ['start', 'finding', 'plan_change', 'blocked']")\n    expect(core).toContain("sendEvent(controller, encoder, 'commentary'")\n    expect(client).toContain("type: 'commentary'")\n  })\n\n  it('supports Gemini multimodal inlineData and implicit-cache telemetry', () => {\n    expect(client).toContain("encoding?: 'utf8' | 'base64'")\n    expect(client).toContain("'application/pdf'")\n    expect(core).toContain('inlineData: { mimeType: attachment.mimeType, data: attachment.content }')\n    expect(legacy).toContain('contentPartsForGemini')\n    expect(legacy).toContain('cachedContentTokenCount')\n  })\n\n  it('prices Gemini 3.8 in the shared 2026 cost telemetry', () => {\n    expect(cost).toContain("'gemini-3.8-flash': { input: 0.75, output: 3.75 }")\n  })\n})\n`)

console.log('Gemini 3.8 product-plan patch applied successfully')
