import type { ReasoningPlan } from './reasoningEngine.ts'

export const AUTHORITATIVE_INVENTORY_FAST_PATH_VERSION = 'authoritative-inventory-fast-path-v1'

const normalize = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const CLASS_TOKENS = new Set(['class', 'classlar', 'classes', 'sinif', 'siniflar', 'klas', 'klaslar'])
const INVENTORY_TOKENS = new Set([
  'hangi', 'var', 'mevcut', 'envanter', 'inventory', 'liste', 'listele', 'listeleyin',
  'tum', 'tumu', 'tumunu', 'hepsi', 'hepsini', 'kac', 'adet',
])
const ALLOWED_TOKENS = new Set([...CLASS_TOKENS, ...INVENTORY_TOKENS])

export const isAuthoritativeBroadClassInventoryRequest = (message: string): boolean => {
  const tokens = normalize(message).split(' ').filter(Boolean)
  if (!tokens.length) return false
  if (!tokens.some(token => CLASS_TOKENS.has(token))) return false
  if (!tokens.some(token => INVENTORY_TOKENS.has(token))) return false
  return tokens.every(token => ALLOWED_TOKENS.has(token))
}

export const buildAuthoritativeInventoryFastPlan = (message: string): ReasoningPlan | null => {
  if (!isAuthoritativeBroadClassInventoryRequest(message)) return null
  const current = String(message || '').trim().slice(0, 700)
  return {
    intent: 'analysis',
    complexity: 'low',
    executionMode: 'knowledge',
    goal: [
      current,
      '[JETWORK_INVENTORY_TARGET] tool=list_class_inventory; objectType=class; prefix=null.',
      'Bu talep exhaustive class inventory kapsamındadır. Semantic planner çağrısı yapılmadan authoritative inventory capabilitysi doğrudan kullanılmalıdır.',
    ].filter(Boolean).join('\n'),
    knowledgeRequired: true,
    webMode: 'none',
    verificationRequired: false,
    creativeMode: false,
    evidenceQueries: [],
    steps: [
      {
        id: 'enumerate-inventory',
        label: 'class envanteri kayıtlarını eksiksiz getir',
        toolHint: 'knowledge',
        successCriteria: 'Authoritative list_class_inventory capabilitysi doğrudan çalışır.',
      },
      {
        id: 'finalize-inventory',
        label: 'Envanter sonucunu deterministik olarak sun',
        toolHint: 'synthesis',
        successCriteria: 'Tam belgelenmiş ve referans verilen class kayıtları eksiksiz ayrıştırılır.',
      },
    ],
    conversationState: {
      continuation: false,
      topic: 'class envanteri',
      userMove: 'new_request',
      priorIntent: 'none',
      rejectedHypotheses: [],
      rejectedScopes: [],
      retainedContext: [],
      openQuestions: [],
    },
    enumerationTarget: {
      tool: 'list_class_inventory',
      objectType: 'class',
      prefix: null,
    },
    orchestratorVersion: AUTHORITATIVE_INVENTORY_FAST_PATH_VERSION,
  }
}
