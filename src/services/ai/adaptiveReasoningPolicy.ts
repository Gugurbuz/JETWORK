import type { AiTurnDecision } from './aiTurnDecision';

export type ReasoningCapabilityId =
  | 'problem_decomposition'
  | 'dependency_planning'
  | 'hypothesis_testing'
  | 'alternative_evaluation'
  | 'contradiction_gap_detection'
  | 'constraint_tracking'
  | 'formal_reasoning'
  | 'code_diagnosis'
  | 'cross_source_synthesis'
  | 'multimodal_synthesis'
  | 'agentic_execution'
  | 'independent_critique';

export interface ReasoningCapability {
  id: ReasoningCapabilityId;
  label: string;
  objective: string;
}

export interface ReasoningStep {
  id: string;
  capability: ReasoningCapabilityId;
  task: string;
  dependsOn: string[];
}

export interface AdaptiveReasoningPlan {
  goal: string;
  capabilities: ReasoningCapability[];
  steps: ReasoningStep[];
  questionPolicy: {
    blocking: string;
    assumable: string;
    deferrable: string;
  };
  outputChecks: string[];
}

export interface BuildAdaptiveReasoningPlanInput {
  userMessage: string;
  recentConversation?: string;
  hasDocument?: boolean;
  knowledgeSourceCount?: number;
  turnDecision?: AiTurnDecision;
}

const CAPABILITIES: Record<ReasoningCapabilityId, ReasoningCapability> = {
  problem_decomposition: {
    id: 'problem_decomposition',
    label: 'Problemi bağlama göre parçalama',
    objective: 'Talebi süreç, aktör, veri, iş kuralı, istisna, entegrasyon, yetki, test ve açık kararlar arasından yalnız ilgili boyutlara ayır.',
  },
  dependency_planning: {
    id: 'dependency_planning',
    label: 'Bağımlı adım planı',
    objective: 'Ön koşulları ve adımlar arası bağımlılıkları açıkça kur; sonraki kararı eksik bir önceki adıma dayandırma.',
  },
  hypothesis_testing: {
    id: 'hypothesis_testing',
    label: 'Kanıtlanabilir hipotezler',
    objective: 'İlk açıklamaya kilitlenme; her hipotezi kontrol yöntemi ve beklenen kanıtla birlikte değerlendir.',
  },
  alternative_evaluation: {
    id: 'alternative_evaluation',
    label: 'Alternatif ve karar desteği',
    objective: 'Anlamlı çözüm seçeneklerini kullanıcı deneyimi, veri güvenliği, süreç etkisi, eski kayıtlar, risk ve uygulama maliyetiyle karşılaştır.',
  },
  contradiction_gap_detection: {
    id: 'contradiction_gap_detection',
    label: 'Çelişki ve bilgi boşluğu analizi',
    objective: 'Kaynaklar ve ifadeler arasındaki çelişkileri, eksik kararları ve bunların analize etkisini bul.',
  },
  constraint_tracking: {
    id: 'constraint_tracking',
    label: 'Koşul ve kısıt takibi',
    objective: 'Koşulları, istisnaları, yetkileri, eski-yeni kayıt ayrımını ve sonraki süreç etkisini analiz boyunca koru.',
  },
  formal_reasoning: {
    id: 'formal_reasoning',
    label: 'Mantıksal ve sayısal doğrulama',
    objective: 'Formül, eşik, sınır değer, yuvarlama, boş değer ve para birimi gibi uç durumları test edilebilir kurallara çevir.',
  },
  code_diagnosis: {
    id: 'code_diagnosis',
    label: 'Kod ve davranış teşhisi',
    objective: 'Kodun amacını, gerçek davranışını, iş ihtiyacı uyumunu, yan etkilerini ve doğrulama yolunu birlikte incele.',
  },
  cross_source_synthesis: {
    id: 'cross_source_synthesis',
    label: 'Kaynaklar arası sentez',
    objective: 'Talep, konuşma, mevcut doküman, proje hafızası ve araştırma bulgularını kanıt durumlarını karıştırmadan ilişkilendir.',
  },
  multimodal_synthesis: {
    id: 'multimodal_synthesis',
    label: 'Çoklu ortam kanıt sentezi',
    objective: 'Metin, görsel, PDF, ses, video ve log bulgularını aynı olayın izleri olarak zaman ve neden-sonuç ilişkisiyle birleştir.',
  },
  agentic_execution: {
    id: 'agentic_execution',
    label: 'Agentic yürütme disiplini',
    objective: 'Hedefi, tamamlanan adımları, değişen dosyaları, varsayımları, testleri, blokajları ve kullanıcı onayı gereken noktaları takip et.',
  },
  independent_critique: {
    id: 'independent_critique',
    label: 'Bağımsız sonuç eleştirisi',
    objective: 'Nihai sonuçtan önce kapsam, çelişki, istisna, geçmiş kayıt, yetki, loglama, test edilebilirlik ve kaynak sadakatini ayrı bir kontrol geçişinde değerlendir.',
  },
};

function normalize(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isDocumentAction(decision?: AiTurnDecision): boolean {
  return !!decision?.documentPolicy.shouldUpdateDocument
    || ['draft_document', 'revise_document', 'repair_document', 'validate_document']
      .includes(decision?.action || '');
}

function selectCapabilities(input: BuildAdaptiveReasoningPlanInput): ReasoningCapabilityId[] {
  const text = normalize([input.recentConversation || '', input.userMessage].filter(Boolean).join('\n'));
  const documentWork = isDocumentAction(input.turnDecision)
    || matches(text, /\b(analiz|dokuman|kavramsal|tasarim|gereksinim|surec|kabul kriter|test senaryo)\b/);
  const integrationOrProcess = matches(text, /\b(entegrasyon|api|rfc|sap|crm|isu|c4c|veri akisi|surec|workflow|adim|bagiml)\b/);
  const diagnostic = matches(text, /\b(hata|sorun|neden|kok neden|gelmiyor|calismiyor|basarisiz|timeout|kilit|inactive|bug|502|500|403|401)\b/);
  const decisionSupport = matches(text, /\b(alternatif|secenek|hangisi|oner|karar|tasarla|engelle|gizle|pasif|cozum)\b/)
    || input.turnDecision?.action === 'preview_change';
  const conditional = matches(text, /\b(eger|ise|kosul|kisit|yetki|status|statu|eski kayit|mevcut belge|gecmis kayit|istisna|sadece|tum)\b/);
  const numericContext = /\b(formul|hesapla|esik|oran|yuvarla|maliyet|gelir|karlilik|sla|sinir deger)\b/;
  const numeric = /[%₺€$]/.test(text)
    || numericContext.test(text)
    || (
      /\b\d+(?:[.,]\d+)?\b/.test(text)
      && /\b(limit|sure|tutar|adet|gun|saat|yuzde)\b/.test(text)
    );
  const code = matches(text, /\b(kod|repo|repository|abap|typescript|javascript|sql|program|fonksiyon|class|commit|runtime)\b/);
  const multimodal = matches(text, /\b(gorsel|ekran goruntusu|pdf|video|ses|log dosyasi|ekli dosya|fotograf)\b/);
  const execution = matches(text, /\b(uygula|duzelt|gelistir|test et|commit|push|pr|deploy|yayinla|incele.*yap)\b/);
  const multipleSources = !!input.hasDocument
    || (input.knowledgeSourceCount || 0) > 0
    || !!input.turnDecision?.sourcePolicy.requiresExternalResearch;

  const selected: ReasoningCapabilityId[] = [];
  if (documentWork || integrationOrProcess || diagnostic || decisionSupport) selected.push('problem_decomposition');
  if (integrationOrProcess || execution) selected.push('dependency_planning');
  if (diagnostic) selected.push('hypothesis_testing');
  if (decisionSupport) selected.push('alternative_evaluation');
  if (documentWork || multipleSources) selected.push('contradiction_gap_detection');
  if (conditional || documentWork) selected.push('constraint_tracking');
  if (numeric) selected.push('formal_reasoning');
  if (code) selected.push('code_diagnosis');
  if (multipleSources) selected.push('cross_source_synthesis');
  if (multimodal) selected.push('multimodal_synthesis');
  if (execution) selected.push('agentic_execution');
  if (documentWork) selected.push('independent_critique');

  return unique(selected);
}

function buildSteps(capabilityIds: ReasoningCapabilityId[]): ReasoningStep[] {
  const selected = new Set(capabilityIds);
  const steps: ReasoningStep[] = [];
  const add = (capability: ReasoningCapabilityId, task: string, dependencies: ReasoningCapabilityId[] = []): void => {
    if (!selected.has(capability)) return;
    const dependencyIds = dependencies
      .map(dep => steps.find(step => step.capability === dep)?.id)
      .filter((id): id is string => !!id);
    steps.push({
      id: `S${steps.length + 1}`,
      capability,
      task,
      dependsOn: dependencyIds,
    });
  };

  add('cross_source_synthesis', 'Kullanılabilir kaynakları ve kanıt durumlarını ayır.');
  add('multimodal_synthesis', 'Farklı ortam bulgularını ortak olay çizelgesine bağla.', ['cross_source_synthesis']);
  add('problem_decomposition', 'Talebe uygun inceleme boyutlarını seç ve alt problemlere ayır.', ['cross_source_synthesis', 'multimodal_synthesis']);
  add('contradiction_gap_detection', 'Çelişkileri ve karar etkisi olan bilgi boşluklarını sınıflandır.', ['problem_decomposition']);
  add('constraint_tracking', 'Koşul, istisna, yetki ve eski-yeni kayıt kurallarını sabitle.', ['problem_decomposition', 'contradiction_gap_detection']);
  add('hypothesis_testing', 'Olası nedenleri kontrol yöntemi ve beklenen kanıtla sınanabilir yap.', ['problem_decomposition', 'contradiction_gap_detection']);
  add('formal_reasoning', 'Kuralları ve sınır durumlarını biçimsel/test edilebilir hale getir.', ['constraint_tracking']);
  add('code_diagnosis', 'Kod davranışını iş ihtiyacı ve yan etkilerle karşılaştır.', ['hypothesis_testing', 'constraint_tracking']);
  add('alternative_evaluation', 'Uygulanabilir seçenekleri ortak karar ölçütleriyle karşılaştır.', ['constraint_tracking', 'hypothesis_testing', 'formal_reasoning', 'code_diagnosis']);
  add('dependency_planning', 'Çözüm ve doğrulama adımlarını ön koşullarıyla sırala.', ['constraint_tracking', 'alternative_evaluation', 'code_diagnosis']);
  add('agentic_execution', 'Uygulama, test ve teslim durumunu izlenebilir biçimde yürüt.', ['dependency_planning']);
  add('independent_critique', 'Taslağı bağımsız kalite kontrolünden geçir ve yalnız bulgu üret.', [
    'dependency_planning',
    'alternative_evaluation',
    'formal_reasoning',
    'code_diagnosis',
  ]);

  return steps;
}

export function buildAdaptiveReasoningPlan(input: BuildAdaptiveReasoningPlanInput): AdaptiveReasoningPlan {
  const capabilityIds = selectCapabilities(input);
  const capabilities = capabilityIds.map(id => CAPABILITIES[id]);
  const goal = input.userMessage.trim().slice(0, 240)
    || 'Kullanıcı talebini kanıt, kısıt ve kalite disipliniyle sonuçlandır.';

  return {
    goal,
    capabilities,
    steps: buildSteps(capabilityIds),
    questionPolicy: {
      blocking: 'Cevabı çözüm yönünü veya pahalı/geri dönüşü zor bir kararı değiştirecekse kullanıcıya sor.',
      assumable: 'Geri dönüşü kolay ve açıkça etiketlenebilir ise [VARSAYIM] ile ilerle.',
      deferrable: 'İlk karar veya taslak için zorunlu değilse [AÇIK KONU] olarak kaydet; kullanıcıya soru yığma.',
    },
    outputChecks: [
      'İş ihtiyacı ile teknik çözüm birbirine karıştırılmadı mı?',
      'Her kritik iş kuralı ve kabul kriteri test edilebilir mi?',
      'Happy path yanında istisna, kısmi başarı ve hata davranışı ele alındı mı?',
      'Eski kayıtlar, yetki, audit/log ve sonraki süreç etkisi gerektiği yerde değerlendirildi mi?',
      'Kaynak, çıkarım, varsayım, çelişki ve açık konu ayrımı korundu mu?',
      'Sonuç seçili artifact profiline ve AiTurnDecision kararına uyuyor mu?',
    ],
  };
}

export function renderAdaptiveReasoningInstruction(plan: AdaptiveReasoningPlan): string {
  if (plan.capabilities.length === 0) {
    return [
      '[ADAPTIF MUHAKEME POLITIKASI]',
      '- Bu tur basit bir yanit turudur; gereksiz analiz sablonu veya dokuman omurgasi kurma.',
      '- AiTurnDecision ana karar otoritesidir.',
    ].join('\n');
  }

  return [
    '[ADAPTIF MUHAKEME POLITIKASI]',
    '- Bu politika hangi inceleme hareketlerinin uygulanacağını belirler; final aksiyonu ve artifact yapısını değiştiremez.',
    '- Gizli zincir düşünceyi kullanıcıya veya JSON alanlarına dökme; yalnız sonuç, kısa çalışma özeti ve karar gerekçesi üret.',
    '',
    'Seçilen yetenekler:',
    ...plan.capabilities.map(item => `- ${item.label}: ${item.objective}`),
    '',
    'Bağımlı çalışma planı:',
    ...plan.steps.map(step => (
      `- ${step.id} ${CAPABILITIES[step.capability].label}`
      + `${step.dependsOn.length ? ` (ön koşul: ${step.dependsOn.join(', ')})` : ''}: ${step.task}`
    )),
    '',
    'Soru önceliği:',
    `- BLOKE EDEN: ${plan.questionPolicy.blocking}`,
    `- VARSAYILABILIR: ${plan.questionPolicy.assumable}`,
    `- ERTELENEBILIR: ${plan.questionPolicy.deferrable}`,
    '',
    'Bağımsız son kontrol:',
    ...plan.outputChecks.map(check => `- ${check}`),
  ].join('\n');
}

export function buildAdaptiveReasoningSummary(plan: AdaptiveReasoningPlan): string {
  if (plan.capabilities.length === 0) return 'Adaptif muhakeme: basit yanıt modu.';
  return [
    `Adaptif muhakeme: ${plan.capabilities.length} yetenek seçildi.`,
    `Çalışma sırası: ${plan.steps.map(step => `${step.id}:${CAPABILITIES[step.capability].label}`).join(' → ')}`,
  ].join('\n');
}
