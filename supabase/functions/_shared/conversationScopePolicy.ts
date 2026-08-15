import type { ReasoningPlan } from './reasoningEngine.ts'
import type { PriorExecutionContext, SemanticContextMessage } from './semanticOrchestrator.ts'
import { shouldResumeAssistantActiveOperation } from './operationState.ts'

const MESSAGE_METHOD_PREFIX = '__jetwork_message_methods__'

const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const hasStem = (text: string, stem: string) => text.split(' ').some(token => token.startsWith(stem))

const explicitWebResearchRequested = (message: string) => {
  const text = normalize(message)
  return hasStem(text, 'arastir')
    || /\b(?:web|internet|internette|internetten|google|online|latest|guncel|haber|mevzuat|resmi dokuman|dis kaynak)\b/.test(text)
}

const objectTypeFromMessage = (message: string) => {
  const text = normalize(message)
  if (/\b(class|classlar|classes|sinif|siniflar|klas|klaslar)\b/.test(text)) return 'class'
  if (hasStem(text, 'method') || hasStem(text, 'metot')) return 'method'
  if (hasStem(text, 'function') || hasStem(text, 'fonksiyon')) return 'function'
  if (hasStem(text, 'message') || hasStem(text, 'mesaj') || hasStem(text, 'hata')) return 'message'
  if (hasStem(text, 'table') || hasStem(text, 'tablo')) return 'table'
  if (hasStem(text, 'interface') || hasStem(text, 'arayuz')) return 'interface'
  return null
}

const asksForInventory = (message: string, objectType: string | null) => {
  if (!objectType) return false
  const text = normalize(message)
  return /\b(envanter|inventory|liste|listele|listeleyin|tum|tumu|tumunu|hepsi|hepsini|hangi|kac|baska|daha cok)\b/.test(text)
    || /\b(var|yok)\b/.test(text)
}

const asksForMessageMethodInventory = (message: string) => {
  const text = normalize(message)
  const hasMessage = hasStem(text, 'message') || hasStem(text, 'mesaj') || hasStem(text, 'hata')
  const hasMethod = hasStem(text, 'method') || hasStem(text, 'metot') || hasStem(text, 'fonksiyon')
  const inventoryLanguage = /\b(envanter|inventory|liste|listele|listeleyin|tum|tumu|tumunu|hepsi|hepsini|hangi|kac)\b/.test(text)
  const relationLanguage = hasStem(text, 'gec') || /\b(tetikleyen|ureten|emit|emits)\b/.test(text)
  return hasMessage && hasMethod && (inventoryLanguage || relationLanguage)
}

const explicitlyRelational = (message: string) => {
  const text = normalize(message)
  return /\b(ilgili|iliskili|bagli|kullanan|cagiran|ureten|ait|icindeki|altindaki|tetikleyen)\b/.test(text)
    || hasStem(text, 'gec')
}

const challengesScopeCompleteness = (message: string) => {
  const text = normalize(message)
  return /\b(baska|daha cok|eksik|tamami|tumunu|hepsi|yok mu|olmali|olmaliydi|degil)\b/.test(text)
}

const isEnumerationContinuation = (message: string) => {
  const text = normalize(message)
  return /\b(devam|devamini|sonraki|kalan|kismi|kisim|bolum|part)\b/.test(text)
    || /\b\d+\s+\d+lik\b/.test(text)
    || /\b(?:ikinci|ucuncu|dorduncu)\b/.test(text)
}

const definitionLookupIdentifier = (message: string): string | null => {
  const text = normalize(message)
  const match = text.match(/^([a-z0-9_]{2,40})\s+(?:ne demek|nedir|ne anlama gelir|acilimi(?: nedir| ne)?|what is|meaning|stands for)\b/i)
  return match?.[1] ? cleanText(match[1], 40) : null
}

const latestAssistant = (conversation: SemanticContextMessage[]) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === 'assistant') return cleanText(conversation[index].content.replace(/\s+/g, ' '), 700)
  }
  return ''
}

const unique = (values: string[], limit = 6) => [...new Set(values.map(value => cleanText(value, 320)).filter(Boolean))].slice(-limit)
const inventoryPrefix = (relationMode: boolean) => relationMode ? MESSAGE_METHOD_PREFIX : null

const configureInventoryPlan = (input: {
  plan: ReasoningPlan
  currentMessage: string
  conversation: SemanticContextMessage[]
  objectType: string
  tool: 'list_knowledge_catalog' | 'list_class_inventory'
  prefix?: string | null
  cursor?: string | null
  topic?: string
}) => {
  const { plan } = input
  const previousTopic = cleanText(plan.conversationState?.topic, 320)
  const scopeChallenge = challengesScopeCompleteness(input.currentMessage)
  const inventoryTopic = input.topic || (input.objectType === 'class' ? 'class envanteri' : `${input.objectType} envanteri`)
  const rejectedScopes = scopeChallenge
    ? unique([
        ...(plan.conversationState?.rejectedScopes || []),
        previousTopic && normalize(previousTopic) !== normalize(inventoryTopic) ? previousTopic : '',
        latestAssistant(input.conversation),
      ])
    : unique(plan.conversationState?.rejectedScopes || [])

  plan.intent = 'analysis'
  plan.complexity = 'low'
  plan.executionMode = 'knowledge'
  plan.knowledgeRequired = true
  plan.verificationRequired = false
  plan.webMode = 'none'
  plan.enumerationTarget = {
    tool: input.tool,
    objectType: input.objectType,
    prefix: input.prefix || null,
    cursor: input.cursor || null,
  }
  plan.goal = [
    cleanText(input.currentMessage, 700),
    `[JETWORK_INVENTORY_TARGET] tool=${input.tool}; objectType=${input.objectType}; prefix=${input.prefix || 'null'}.`,
    input.cursor
      ? `Bu talep önceki deterministik envanter sonucunun devamıdır. Doğrulanmış cursor=${input.cursor} sonrasından devam et; semantic search başlatma.`
      : 'Bu talep exhaustive inventory kapsamındadır. Önceki dar konu filtresini kullanıcı açıkça istemedikçe taşıma; semantic search yerine hedef listeleme capabilitysini kullan.',
  ].filter(Boolean).join('\n')
  plan.evidenceQueries = []
  plan.steps = [
    {
      id: 'enumerate-inventory',
      label: `${inventoryTopic} kayıtlarını deterministik getir`,
      toolHint: 'knowledge',
      successCriteria: input.cursor
        ? 'Önceki sayfanın son doğrulanmış kaydından pagination devam eder; semantic search kullanılmaz.'
        : 'Yapısal envanter capabilitysi kullanılır; semantic aramayla daraltılmaz.',
    },
    {
      id: 'finalize-inventory',
      label: 'Envanter sonucunu deterministik sun',
      toolHint: 'synthesis',
      successCriteria: 'Yalnız authoritative liste ve ilişki kayıtlarında gerçekten bulunan teknik bilgiler sunulur.',
    },
  ]

  plan.conversationState = {
    continuation: Boolean(input.cursor || plan.conversationState?.continuation || input.conversation.length),
    topic: inventoryTopic,
    userMove: input.cursor ? 'follow_up' : (scopeChallenge ? 'correction' : (previousTopic && normalize(previousTopic) !== normalize(inventoryTopic) ? 'topic_shift' : 'follow_up')),
    operationMove: input.cursor ? 'continue' : (plan.conversationState?.operationMove || 'none'),
    priorIntent: plan.conversationState?.priorIntent || 'analysis',
    rejectedHypotheses: [...(plan.conversationState?.rejectedHypotheses || [])],
    rejectedScopes,
    retainedContext: [...(plan.conversationState?.retainedContext || [])].slice(-8),
    openQuestions: [],
  }
  return plan
}

export const applyConversationScopeInventoryPolicy = (input: {
  plan: ReasoningPlan
  currentMessage: string
  conversation: SemanticContextMessage[]
  priorExecution?: PriorExecutionContext
}): ReasoningPlan => {
  const plan: ReasoningPlan = {
    ...input.plan,
    conversationState: input.plan.conversationState
      ? {
          ...input.plan.conversationState,
          rejectedHypotheses: [...(input.plan.conversationState.rejectedHypotheses || [])],
          rejectedScopes: [...(input.plan.conversationState.rejectedScopes || [])],
          retainedContext: [...(input.plan.conversationState.retainedContext || [])],
          openQuestions: [...(input.plan.conversationState.openQuestions || [])],
        }
      : undefined,
  }

  const definitionIdentifier = definitionLookupIdentifier(input.currentMessage)
  if (definitionIdentifier) {
    const explicitWebResearch = explicitWebResearchRequested(input.currentMessage)
    plan.intent = explicitWebResearch ? 'research' : 'analysis'
    plan.complexity = explicitWebResearch ? 'medium' : 'low'
    plan.executionMode = explicitWebResearch ? 'research' : 'knowledge'
    plan.promptProfile = explicitWebResearch ? 'research' : 'knowledge'
    plan.knowledgeRequired = true
    plan.verificationRequired = true
    plan.webMode = explicitWebResearch ? 'required' : 'none'
    plan.evidenceQueries = [
      definitionIdentifier,
      cleanText(input.currentMessage, 300),
      ...(explicitWebResearch ? [`${definitionIdentifier} resmi API entegrasyon dokümantasyonu`] : []),
    ]
    plan.goal = [
      cleanText(input.currentMessage, 700),
      `[JETWORK_DEFINITION_LOOKUP] identifier=${definitionIdentifier}.`,
      'Bu kısa terim veya kısaltmanın kurum içi anlamını yalnız JetWork bilgi bankası kanıtı açıkça destekliyorsa kurumsal gerçek olarak sun.',
      explicitWebResearch
        ? 'Kullanıcı açıkça araştırma istiyor. Kurumsal lookup bu talebi engellemesin; resmi veya güvenilir web kaynaklarında tanım, entegrasyon ve teknik API ayrıntılarını araştır.'
        : 'Bilgi bankasında doğrudan destekleyen kanıt yoksa doğrulanmış kurum içi tanım bulunamadığını açıkça söyle; Enerjisa, SAP veya başka bir kurumsal açılım uydurma.',
      'Kurumsal kanıt ile kamuya açık genel bilgiyi açıkça ayır; doğrulanmamış kurum özelini kesin gerçek gibi yazma.',
    ].join('\n')
    plan.steps = explicitWebResearch
      ? [
          {
            id: 'lookup-definition',
            label: `${definitionIdentifier} için kurumsal bağlamı kontrol et`,
            toolHint: 'knowledge',
            successCriteria: 'Terimi doğrudan destekleyen kurum içi kanıt bulunur veya bulunamadığı doğrulanır.',
          },
          {
            id: 'research-public-definition',
            label: `${definitionIdentifier} için resmi web kaynaklarında tanım ve teknik entegrasyonu araştır`,
            toolHint: 'web',
            successCriteria: 'Tanım ve API/entegrasyon ayrıntıları resmi veya güvenilir güncel kaynaklarla desteklenir.',
          },
          {
            id: 'verify-definition',
            label: 'Kurumsal ve web kaynaklarını ayırıp doğrula',
            toolHint: 'verification',
            successCriteria: 'Kurum özeli ile kamuya açık genel bilgi birbirine karıştırılmaz.',
          },
          {
            id: 'answer-definition',
            label: 'Doğrulanmış bulgularla yanıtla',
            toolHint: 'synthesis',
            successCriteria: 'Kaynaklı genel bilgi sunulur; kanıtsız kurum özeli üretilmez.',
          },
        ]
      : [
          {
            id: 'lookup-definition',
            label: `${definitionIdentifier} için kurumsal kanıt ara`,
            toolHint: 'knowledge',
            successCriteria: 'Terimi doğrudan destekleyen yayımlanmış kanıt bulunur veya bulunamadığı doğrulanır.',
          },
          {
            id: 'verify-definition',
            label: 'Tanımın kanıtla desteklendiğini doğrula',
            toolHint: 'verification',
            successCriteria: 'Kurumsal tanım yalnız doğrudan kanıt varsa kesin ifade edilir.',
          },
          {
            id: 'answer-definition',
            label: 'Kanıt durumunu açıkça belirterek yanıtla',
            toolHint: 'synthesis',
            successCriteria: 'Kanıtsız kurumsal açılım üretilmez.',
          },
        ]
    plan.conversationState = {
      continuation: false,
      topic: definitionIdentifier,
      userMove: 'new_request',
      priorIntent: plan.conversationState?.priorIntent || 'none',
      rejectedHypotheses: [...(plan.conversationState?.rejectedHypotheses || [])],
      rejectedScopes: [...(plan.conversationState?.rejectedScopes || [])],
      retainedContext: [...(plan.conversationState?.retainedContext || [])].slice(-8),
      openQuestions: [],
    }
    return plan
  }

  const activeOperation = input.priorExecution?.activeOperation
  const semanticFallbackUsed = String(plan.orchestratorVersion || '').includes('safe-fallback')
  const resumeActiveOperation = shouldResumeAssistantActiveOperation({
    activeOperation,
    operationMove: plan.conversationState?.operationMove,
    semanticFallbackUsed,
    fallbackContinuationHint: semanticFallbackUsed && isEnumerationContinuation(input.currentMessage),
  })
  const activeObjectType = activeOperation?.objectType || (activeOperation?.tool === 'list_class_inventory' ? 'class' : null)
  if (resumeActiveOperation && activeOperation?.nextCursor && activeObjectType) {
    const relationMode = activeOperation.tool === 'list_knowledge_catalog'
      && activeOperation.objectType === 'message'
      && activeOperation.prefix === MESSAGE_METHOD_PREFIX
    return configureInventoryPlan({
      plan,
      currentMessage: input.currentMessage,
      conversation: input.conversation,
      objectType: activeObjectType,
      tool: activeOperation.tool,
      prefix: activeOperation.prefix,
      cursor: activeOperation.nextCursor,
      topic: relationMode ? 'hata mesajı ve metot envanteri' : undefined,
    })
  }

  if (asksForMessageMethodInventory(input.currentMessage)) {
    return configureInventoryPlan({
      plan,
      currentMessage: input.currentMessage,
      conversation: input.conversation,
      objectType: 'message',
      tool: 'list_knowledge_catalog',
      prefix: inventoryPrefix(true),
      topic: 'hata mesajı ve metot envanteri',
    })
  }

  const objectType = objectTypeFromMessage(input.currentMessage)
  if (!asksForInventory(input.currentMessage, objectType) || explicitlyRelational(input.currentMessage)) return plan

  return configureInventoryPlan({
    plan,
    currentMessage: input.currentMessage,
    conversation: input.conversation,
    objectType: objectType!,
    tool: objectType === 'class' ? 'list_class_inventory' : 'list_knowledge_catalog',
  })
}
