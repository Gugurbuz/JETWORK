import type {
  ReasoningComplexity,
  ReasoningIntent,
  WebMode,
} from '../../supabase/functions/_shared/reasoningEngine';

export type ReasoningGoldenCategory =
  | 'simple'
  | 'sap_diagnosis'
  | 'analysis'
  | 'decision'
  | 'research'
  | 'project'
  | 'document'
  | 'attachment';

export interface ReasoningGoldenRouteExpectation {
  intent: ReasoningIntent;
  complexity: ReasoningComplexity;
  knowledgeRequired: boolean;
  webMode: WebMode;
  verificationRequired: boolean;
  creativeMode: boolean;
}

export interface ReasoningGoldenRuntimeExpectation {
  requiredStages: string[];
  forbiddenStages?: string[];
  minimumKnowledgeSources?: number;
  minimumWebSources?: number;
  minimumToolCalls?: number;
  requireUncertaintyLanguageWhenNoEvidence?: boolean;
  requiredAnswerConcepts?: string[];
  forbiddenAnswerConcepts?: string[];
}

export interface ReasoningGoldenScenario {
  id: string;
  title: string;
  category: ReasoningGoldenCategory;
  request: string;
  attachmentCount?: number;
  critical: boolean;
  liveCanary?: boolean;
  expectedRoute: ReasoningGoldenRouteExpectation;
  expectedRuntime: ReasoningGoldenRuntimeExpectation;
}

const lowSimple = (): ReasoningGoldenRuntimeExpectation => ({
  requiredStages: ['routing', 'answering'],
  forbiddenStages: ['searching_knowledge', 'searching_web', 'verifying'],
  minimumKnowledgeSources: 0,
  minimumWebSources: 0,
  minimumToolCalls: 0,
});

const internalEvidence = (minimumToolCalls = 1): ReasoningGoldenRuntimeExpectation => ({
  requiredStages: ['routing', 'planning', 'searching_knowledge', 'verifying', 'synthesizing', 'answering'],
  minimumKnowledgeSources: 1,
  minimumToolCalls,
});

const requiredWeb = (knowledge = false): ReasoningGoldenRuntimeExpectation => ({
  requiredStages: [
    'routing',
    'planning',
    ...(knowledge ? ['searching_knowledge'] : []),
    'searching_web',
    'verifying',
    'synthesizing',
    'answering',
  ],
  minimumKnowledgeSources: knowledge ? 1 : 0,
  minimumWebSources: 1,
  minimumToolCalls: knowledge ? 2 : 1,
});

export const REASONING_GOLDEN_SCENARIOS: ReasoningGoldenScenario[] = [
  {
    id: 'rq-01-simple-definition',
    title: 'Basit kavram sorusu doğrudan cevaplanır',
    category: 'simple',
    request: 'P50 ne demek?',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'simple_answer', complexity: 'low', knowledgeRequired: false,
      webMode: 'none', verificationRequired: false, creativeMode: false,
    },
    expectedRuntime: lowSimple(),
  },
  {
    id: 'rq-02-simple-role-question',
    title: 'Genel rol açıklamasında gereksiz araştırma yapılmaz',
    category: 'simple',
    request: 'Product Owner ne yapar?',
    critical: false,
    expectedRoute: {
      intent: 'simple_answer', complexity: 'low', knowledgeRequired: false,
      webMode: 'none', verificationRequired: false, creativeMode: false,
    },
    expectedRuntime: lowSimple(),
  },
  {
    id: 'rq-03-sap-diagnosis-message',
    title: 'SAP hata kodu teşhisi kurumsal kanıta zorlanır',
    category: 'sap_diagnosis',
    request: 'ZCRM2-545 hangi koşulda alınır? Bilgi bankasından teknik kanıtla incele.',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'sap_diagnosis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(2),
  },
  {
    id: 'rq-04-sap-deep-root-cause',
    title: 'Detaylı SAP kök neden incelemesi high reasoning kullanır',
    category: 'sap_diagnosis',
    request: 'ZCRM_COST 030 hatasının kök nedenini detaylı incele; ilgili method, tablo ve bağımlılıkları teknik kanıtla doğrula.',
    critical: true,
    expectedRoute: {
      intent: 'sap_diagnosis', complexity: 'high', knowledgeRequired: true,
      webMode: 'if_internal_insufficient', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(2),
  },
  {
    id: 'rq-05-sap-everh-chain',
    title: 'EVERH ters kayıt problemi zincirli teşhis olarak ele alınır',
    category: 'sap_diagnosis',
    request: 'EVERH kayıt sıralaması nedeniyle ters kayıtta hata alınmasının kök nedenini uçtan uca incele ve ilgili ABAP akışını doğrula.',
    critical: true,
    expectedRoute: {
      intent: 'sap_diagnosis', complexity: 'high', knowledgeRequired: true,
      webMode: 'if_internal_insufficient', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(2),
  },
  {
    id: 'rq-06-technical-analysis',
    title: 'Teknik entegrasyon analizi kurumsal bilgi kullanır',
    category: 'analysis',
    request: 'SAP CRM ile FICA arasındaki borç kontrol entegrasyonunu analiz et.',
    critical: true,
    expectedRoute: {
      intent: 'analysis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(1),
  },
  {
    id: 'rq-07-deep-architecture',
    title: 'Uçtan uca mimari analiz high complexity olur',
    category: 'analysis',
    request: 'SAP CRM FICA Billing entegrasyonunu uçtan uca detaylı analiz et ve mimariyi tasarla.',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'analysis', complexity: 'high', knowledgeRequired: true,
      webMode: 'if_internal_insufficient', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(2),
  },
  {
    id: 'rq-08-technical-object-analysis',
    title: 'Z nesnesi analizi teknik bilgi aramasına gider',
    category: 'analysis',
    request: 'Z_FICA_CRM_CHECK_REVERSE fonksiyonunun ne yaptığını ve kullandığı tabloları analiz et.',
    critical: true,
    expectedRoute: {
      intent: 'analysis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(1),
  },
  {
    id: 'rq-09-technical-decision',
    title: 'Teknik çözüm seçimi alternatif üretme modunu açar',
    category: 'decision',
    request: 'CRM entegrasyonu için detaylı alternatifler üret, çözümleri karşılaştır ve en iyi yaklaşımı öner.',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'decision', complexity: 'high', knowledgeRequired: true,
      webMode: 'if_internal_insufficient', verificationRequired: true, creativeMode: true,
    },
    expectedRuntime: internalEvidence(1),
  },
  {
    id: 'rq-10-process-decision',
    title: 'Fonksiyonel süreç kararında yaratıcı alternatif modu kullanılır',
    category: 'decision',
    request: 'Onay süreci için alternatif çözümleri karşılaştır ve en uygun yaklaşımı öner.',
    critical: false,
    expectedRoute: {
      intent: 'decision', complexity: 'medium', knowledgeRequired: false,
      webMode: 'none', verificationRequired: true, creativeMode: true,
    },
    expectedRuntime: {
      requiredStages: ['routing', 'planning', 'verifying', 'synthesizing', 'answering'],
      forbiddenStages: ['searching_web'],
      minimumToolCalls: 0,
    },
  },
  {
    id: 'rq-11-current-official-docs',
    title: 'Güncel resmi API dokümanı web araştırmasını zorunlu kılar',
    category: 'research',
    request: 'OpenAI API web search için güncel resmi dokümanı internette araştır.',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'research', complexity: 'medium', knowledgeRequired: true,
      webMode: 'required', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: requiredWeb(true),
  },
  {
    id: 'rq-12-current-regulation',
    title: 'Güncel mevzuat sorusu dış kaynağa gider',
    category: 'research',
    request: '2026 güncel KVKK mevzuatındaki son değişiklikleri resmi kaynaklardan internette araştır.',
    critical: true,
    expectedRoute: {
      intent: 'research', complexity: 'medium', knowledgeRequired: false,
      webMode: 'required', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: requiredWeb(false),
  },
  {
    id: 'rq-13-current-market',
    title: 'Güncel piyasa bilgisi web kaynağı olmadan cevaplanmaz',
    category: 'research',
    request: 'Bugünkü elektrik piyasasıyla ilgili güncel gelişmeleri internette araştır ve kaynak göster.',
    critical: false,
    expectedRoute: {
      intent: 'research', complexity: 'medium', knowledgeRequired: false,
      webMode: 'required', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: requiredWeb(false),
  },
  {
    id: 'rq-14-project-roadmap',
    title: 'Roadmap planlama isteği proje intentine gider',
    category: 'project',
    request: 'İkinci yarıyıl roadmap ve sprint önceliklerini planla.',
    critical: false,
    expectedRoute: {
      intent: 'project', complexity: 'medium', knowledgeRequired: false,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      requiredStages: ['routing', 'planning', 'verifying', 'synthesizing', 'answering'],
      forbiddenStages: ['searching_web'],
      minimumToolCalls: 0,
    },
  },
  {
    id: 'rq-15-project-backlog',
    title: 'Backlog önceliklendirme proje reasoning kullanır',
    category: 'project',
    request: 'Backlog maddelerini efor ve önceliğe göre sırala ve sprint planı öner.',
    critical: false,
    expectedRoute: {
      intent: 'project', complexity: 'medium', knowledgeRequired: false,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      requiredStages: ['routing', 'planning', 'verifying', 'synthesizing', 'answering'],
      forbiddenStages: ['searching_web'],
      minimumToolCalls: 0,
    },
  },
  {
    id: 'rq-16-document-create-system-route',
    title: 'Sistem document route işaretini korur',
    category: 'document',
    request: '[Sistem yönlendirmesi: Kullanıcı doküman istedi]\nEnerjisa iş analizi dokümanı oluştur.',
    critical: true,
    expectedRoute: {
      intent: 'document', complexity: 'high', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      ...internalEvidence(1),
      forbiddenStages: ['searching_web'],
    },
  },
  {
    id: 'rq-17-document-create-natural',
    title: 'Doğal dil doküman üretim talebi artifact route olur',
    category: 'document',
    request: 'Bu bilgilerle Enerjisa iş analizi dokümanı hazırla.',
    critical: true,
    liveCanary: true,
    expectedRoute: {
      intent: 'document', complexity: 'high', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      ...internalEvidence(1),
      forbiddenStages: ['searching_web'],
    },
  },
  {
    id: 'rq-18-document-revision-system-route',
    title: 'Doküman revizyon sinyali document intentini korur',
    category: 'document',
    request: '[Sistem yönlendirmesi: Kullanıcı doküman revizyonu istedi]\nMevcut analizde satışçı ifadesini satış uzmanı olarak güncelle.',
    critical: true,
    expectedRoute: {
      intent: 'document', complexity: 'high', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      ...internalEvidence(1),
      forbiddenStages: ['searching_web'],
    },
  },
  {
    id: 'rq-19-attachment-single',
    title: 'Tek attachment basit talebi medium reasoninge çıkarır',
    category: 'attachment',
    request: 'Ekteki içeriği özetle.',
    attachmentCount: 1,
    critical: false,
    expectedRoute: {
      intent: 'simple_answer', complexity: 'medium', knowledgeRequired: false,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      requiredStages: ['routing', 'planning', 'verifying', 'synthesizing', 'answering'],
      forbiddenStages: ['searching_web'],
      minimumToolCalls: 0,
    },
  },
  {
    id: 'rq-20-attachment-multiple',
    title: 'Çoklu attachment high reasoninge çıkarır',
    category: 'attachment',
    request: 'Ekleri karşılaştır ve farkları özetle.',
    attachmentCount: 2,
    critical: false,
    expectedRoute: {
      intent: 'simple_answer', complexity: 'high', knowledgeRequired: false,
      webMode: 'if_internal_insufficient', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      requiredStages: ['routing', 'planning', 'verifying', 'synthesizing', 'answering'],
      minimumToolCalls: 0,
    },
  },
  {
    id: 'rq-21-unknown-internal-error',
    title: 'Kanıt bulunmayan iç hata için uydurma yapılmaz',
    category: 'sap_diagnosis',
    request: 'ZX_UNKNOWN_999 hatasının nedenini bilgi bankasından teknik kanıtla incele; kayıt yoksa açıkça söyle.',
    critical: true,
    expectedRoute: {
      intent: 'sap_diagnosis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: {
      ...internalEvidence(1),
      minimumKnowledgeSources: 0,
      requireUncertaintyLanguageWhenNoEvidence: true,
      forbiddenAnswerConcepts: ['kesin olarak bu methoddan kaynaklanır'],
    },
  },
  {
    id: 'rq-22-cost-analysis',
    title: 'Ninja cost sorusu teknik analiz olarak kanıt toplar',
    category: 'analysis',
    request: 'CRM Ninja cost değerinin hangi kaynaktan geldiğini ve nasıl hesaplandığını analiz et.',
    critical: true,
    expectedRoute: {
      intent: 'analysis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(1),
  },
  {
    id: 'rq-23-c4c-mapping',
    title: 'C4C mapping isteği teknik analiz ve kurumsal kanıt kullanır',
    category: 'analysis',
    request: 'C4C ile CRM arasındaki dengesizlik alanı mappingini analiz et ve teknik alanları doğrula.',
    critical: true,
    expectedRoute: {
      intent: 'analysis', complexity: 'medium', knowledgeRequired: true,
      webMode: 'none', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: internalEvidence(1),
  },
  {
    id: 'rq-24-current-tech-with-internal-context',
    title: 'Teknik güncel araştırma hem iç hem web kanıtını birleştirir',
    category: 'research',
    request: 'Mevcut CRM entegrasyon yaklaşımımızla karşılaştırmak için güncel SAP entegrasyon API önerilerini webde araştır.',
    critical: true,
    expectedRoute: {
      intent: 'research', complexity: 'medium', knowledgeRequired: true,
      webMode: 'required', verificationRequired: true, creativeMode: false,
    },
    expectedRuntime: requiredWeb(true),
  },
];

export const REASONING_GOLDEN_COVERAGE = {
  minimumScenarioCount: 24,
  minimumCriticalScenarios: 12,
  minimumLiveCanaries: 6,
  requiredCategories: [
    'simple', 'sap_diagnosis', 'analysis', 'decision', 'research', 'project', 'document', 'attachment',
  ] as ReasoningGoldenCategory[],
} as const;
