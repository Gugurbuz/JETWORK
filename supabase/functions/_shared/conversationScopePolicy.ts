import type { ReasoningPlan } from './reasoningEngine.ts'
import type { SemanticContextMessage } from './semanticOrchestrator.ts'

const cleanText = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength)
const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const objectTypeFromMessage = (message: string) => {
  const text = normalize(message)
  if (/\b(class|classes|sinif|siniflar|klas|klaslar)\b/.test(text)) return 'class'
  if (/\b(method|methods|metot|metotlar)\b/.test(text)) return 'method'
  if (/\b(function|functions|fonksiyon|fonksiyonlar)\b/.test(text)) return 'function'
  if (/\b(message|messages|mesaj|mesajlar|hata|hatalar)\b/.test(text)) return 'message'
  if (/\b(table|tables|tablo|tablolar)\b/.test(text)) return 'table'
  if (/\b(interface|interfaces|arayuz|arayuzler)\b/.test(text)) return 'interface'
  return null
}

const asksForInventory = (message: string, objectType: string | null) => {
  if (!objectType) return false
  const text = normalize(message)
  return /\b(envanter|inventory|liste|listele|listeleyin|tum|tumu|tumunu|hepsi|hepsini|hangi|kac|baska|daha cok)\b/.test(text)
    || /\b(var|yok)\b/.test(text)
}

const explicitlyRelational = (message: string) => {
  const text = normalize(message)
  return /\b(ilgili|iliskili|bagli|kullanan|cagiran|ureten|ait|icindeki|altindaki)\b/.test(text)
}

const challengesScopeCompleteness = (message: string) => {
  const text = normalize(message)
  return /\b(baska|daha cok|eksik|tamami|tumunu|hepsi|yok mu|olmali|olmaliydi|degil)\b/.test(text)
}

const latestAssistant = (conversation: SemanticContextMessage[]) => {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === 'assistant') return cleanText(conversation[index].content.replace(/\s+/g, ' '), 260)
  }
  return ''
}

const unique = (values: string[], limit = 6) => [...new Set(values.map(value => cleanText(value, 320)).filter(Boolean))].slice(-limit)

export const applyConversationScopeInventoryPolicy = (input: {
  plan: ReasoningPlan
  currentMessage: string
  conversation: SemanticContextMessage[]
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

  const objectType = objectTypeFromMessage(input.currentMessage)
  if (!asksForInventory(input.currentMessage, objectType) || explicitlyRelational(input.currentMessage)) return plan

  const previousTopic = cleanText(plan.conversationState?.topic, 320)
  const scopeChallenge = challengesScopeCompleteness(input.currentMessage)
  const inventoryTopic = objectType === 'class' ? 'class envanteri' : `${objectType} envanteri`
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
  plan.enumerationTarget = objectType === 'class'
    ? { tool: 'list_class_inventory', objectType: 'class', prefix: null }
    : { tool: 'list_knowledge_catalog', objectType, prefix: null }
  plan.goal = [
    cleanText(input.currentMessage, 700),
    `[JETWORK_INVENTORY_TARGET] tool=${plan.enumerationTarget.tool}; objectType=${objectType}; prefix=null.`,
    'Bu talep exhaustive inventory kapsamındadır. Önceki dar konu filtresini kullanıcı açıkça istemedikçe taşıma; semantic search yerine hedef listeleme capabilitysini kullan.',
  ].filter(Boolean).join('\n')
  plan.evidenceQueries = []
  plan.steps = [
    {
      id: 'enumerate-inventory',
      label: `${inventoryTopic} kayıtlarını eksiksiz getir`,
      toolHint: 'knowledge',
      successCriteria: 'Yapısal envanter capabilitysi kullanılır; semantic aramayla daraltılmaz.',
    },
    {
      id: 'finalize-inventory',
      label: 'Envanter sonucunu kayıt türlerini ayırarak sun',
      toolHint: 'synthesis',
      successCriteria: 'Tam belgelenmiş ve referans verilen kayıtlar varsa birbirinden ayrılır.',
    },
  ]

  plan.conversationState = {
    continuation: Boolean(plan.conversationState?.continuation || input.conversation.length),
    topic: inventoryTopic,
    userMove: scopeChallenge ? 'correction' : (previousTopic && normalize(previousTopic) !== normalize(inventoryTopic) ? 'topic_shift' : 'follow_up'),
    priorIntent: plan.conversationState?.priorIntent || 'analysis',
    rejectedHypotheses: [...(plan.conversationState?.rejectedHypotheses || [])],
    rejectedScopes,
    retainedContext: [...(plan.conversationState?.retainedContext || [])].slice(-8),
    openQuestions: [],
  }
  return plan
}
