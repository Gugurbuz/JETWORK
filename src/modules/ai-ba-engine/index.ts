import type { DocumentData, Message, Question, SectionData } from '../../types';

export type BaDiscoveryPriority = 'critical' | 'high' | 'medium';
export type BaDiscoveryFieldId =
  | 'problem'
  | 'goal'
  | 'scope'
  | 'stakeholders'
  | 'users'
  | 'asIs'
  | 'toBe'
  | 'businessRules'
  | 'requirements'
  | 'acceptanceCriteria'
  | 'process'
  | 'data'
  | 'integrations'
  | 'nfr'
  | 'risks';

export interface BaDiscoveryField {
  id: BaDiscoveryFieldId;
  label: string;
  priority: BaDiscoveryPriority;
  weight: number;
  question: string;
  options: string[];
  patterns: RegExp[];
}

export interface BaDiscoveryState {
  readinessScore: number;
  coveredFields: BaDiscoveryField[];
  missingFields: BaDiscoveryField[];
  criticalMissing: BaDiscoveryField[];
  highMissing: BaDiscoveryField[];
  answeredQuestionCount: number;
  questionRoundCount: number;
  isLikelyAnswer: boolean;
}

export interface BaDiscoveryDecision {
  shouldAsk: boolean;
  reason: string;
  state: BaDiscoveryState;
  questions: Question[];
}

export interface BaQualitySectionScore {
  id: string;
  label: string;
  score: number;
  status: 'pass' | 'warn' | 'fail';
  missing: string[];
}

export interface BaQualityReportV2 {
  score: number;
  canPublish: boolean;
  summary: string;
  sectionScores: BaQualitySectionScore[];
  missingDiscoveryFields: string[];
  priorityFixes: string[];
  warnings: string[];
}

export const BA_ENGINE_REVIEW_BLOCK_START = '<!-- BA_ENGINE_REVIEW_START -->';
export const BA_ENGINE_REVIEW_BLOCK_END = '<!-- BA_ENGINE_REVIEW_END -->';

const DISCOVERY_FIELDS: BaDiscoveryField[] = [
  {
    id: 'problem',
    label: 'Problem / ihtiyaç',
    priority: 'critical',
    weight: 10,
    question: 'Çözmek istediğimiz ana iş problemi nedir?',
    options: ['Operasyonel verimsizlik', 'Uyum / kontrol ihtiyacı', 'Yeni ürün veya süreç', 'Mevcut sistem iyileştirme'],
    patterns: [/problem/i, /ihtiya[çc]/i, /a[ğg]r[ıi] nokta/i, /neden yap/i, /sorun/i],
  },
  {
    id: 'goal',
    label: 'Hedef ve iş değeri',
    priority: 'critical',
    weight: 10,
    question: 'Başarıyı hangi hedef veya iş değeriyle ölçeceğiz?',
    options: ['Süreyi azaltma', 'Hata oranını düşürme', 'Gelir / dönüşüm artırma', 'İzlenebilirlik sağlama'],
    patterns: [/ama[çc]/i, /hedef/i, /i[şs] de[ğg]eri/i, /beklenen fayda/i, /başarı/i, /basari/i],
  },
  {
    id: 'scope',
    label: 'Kapsam / kapsam dışı',
    priority: 'critical',
    weight: 9,
    question: 'İlk sürümde kapsam dahilinde ve dışında neler olmalı?',
    options: ['MVP kapsamı yeterli', 'Uçtan uca süreç gerekli', 'Sadece belirli modül', 'Kapsam dışı netleşmeli'],
    patterns: [/kapsam/i, /kapsam d[ıi][şs][ıi]/i, /mvp/i, /dahil/i, /hari[çc]/i],
  },
  {
    id: 'stakeholders',
    label: 'Paydaşlar ve roller',
    priority: 'high',
    weight: 7,
    question: 'Karar veren, kullanan ve etkilenen ana roller kimler?',
    options: ['Operasyon ekibi', 'Yönetici / onaycı', 'Müşteri / son kullanıcı', 'IT / entegrasyon ekibi'],
    patterns: [/payda[şs]/i, /rol/i, /kat[ıi]l[ıi]mc[ıi]/i, /sorumlu/i, /onayc[ıi]/i],
  },
  {
    id: 'users',
    label: 'Kullanıcı grupları',
    priority: 'high',
    weight: 7,
    question: 'Sistemi hangi kullanıcı grupları kullanacak?',
    options: ['Admin', 'Operasyon kullanıcısı', 'Onaycı', 'Dış kullanıcı'],
    patterns: [/kullan[ıi]c[ıi]/i, /persona/i, /admin/i, /yetki/i, /grup/i],
  },
  {
    id: 'asIs',
    label: 'Mevcut durum (As-Is)',
    priority: 'high',
    weight: 7,
    question: 'Bugünkü süreç veya sistem nasıl çalışıyor?',
    options: ['Manuel takip', 'Excel / e-posta', 'Mevcut uygulama', 'Henüz süreç yok'],
    patterns: [/mevcut durum/i, /as[- ]?is/i, /bug[üu]n/i, /şu an/i, /su an/i, /manuel/i],
  },
  {
    id: 'toBe',
    label: 'Hedef durum (To-Be)',
    priority: 'high',
    weight: 7,
    question: 'Hedeflenen yeni çalışma şekli nasıl olmalı?',
    options: ['Otomatik akış', 'Onaylı süreç', 'Self servis ekranlar', 'Raporlanabilir yapı'],
    patterns: [/hedef durum/i, /to[- ]?be/i, /olmal[ıi]/i, /yeni ak[ıi][şs]/i, /tasarl/i],
  },
  {
    id: 'businessRules',
    label: 'İş kuralları',
    priority: 'critical',
    weight: 9,
    question: 'Mutlaka korunması gereken iş kuralları nelerdir?',
    options: ['Onay kuralı', 'Limit / eşik kuralı', 'Zorunlu alan kuralı', 'Rol bazlı yetki kuralı'],
    patterns: [/i[şs] kural/i, /kural/i, /limit/i, /e[şs]ik/i, /zorunlu/i],
  },
  {
    id: 'requirements',
    label: 'Fonksiyonel gereksinimler',
    priority: 'critical',
    weight: 10,
    question: 'Sistemin kesinlikle yapması gereken 3 ana fonksiyon nedir?',
    options: ['Kayıt / güncelleme', 'Onay akışı', 'Raporlama', 'Bildirim / takip'],
    patterns: [/gereksinim/i, /fonksiyonel/i, /fr[-–]?\d+/i, /yapabil/i, /özellik/i, /ozellik/i],
  },
  {
    id: 'acceptanceCriteria',
    label: 'Kabul kriterleri',
    priority: 'critical',
    weight: 9,
    question: 'Bu işin doğru tamamlandığını hangi kabul kriterleri gösterecek?',
    options: ['UAT senaryosu', 'KPI hedefi', 'Rol bazlı kontrol', 'Hata mesajı / validasyon'],
    patterns: [/kabul kriter/i, /uat/i, /başarılı say/i, /basarili say/i, /test/i, /do[ğg]rulan/i],
  },
  {
    id: 'process',
    label: 'Süreç akışı',
    priority: 'high',
    weight: 7,
    question: 'Ana süreç adımları hangi sırayla ilerliyor?',
    options: ['Talep oluşturma', 'Kontrol / validasyon', 'Onay', 'Tamamlama / arşivleme'],
    patterns: [/s[üu]re[çc]/i, /ak[ıi][şs]/i, /bpmn/i, /flow/i, /ad[ıi]m/i, /tetikleyici/i],
  },
  {
    id: 'data',
    label: 'Veri ve kayıt alanları',
    priority: 'high',
    weight: 6,
    question: 'Hangi veriler tutulacak veya raporlanacak?',
    options: ['Temel form alanları', 'Durum / tarihçe', 'Dosya / doküman', 'Audit / log'],
    patterns: [/veri/i, /alan/i, /entity/i, /kay[ıi]t/i, /audit/i, /log/i],
  },
  {
    id: 'integrations',
    label: 'Entegrasyonlar',
    priority: 'medium',
    weight: 5,
    question: 'Harici sistem veya servis entegrasyonu gerekiyor mu?',
    options: ['Kimlik / SSO', 'ERP / SAP', 'Dosya servisi', 'Şimdilik yok'],
    patterns: [/entegrasyon/i, /api/i, /sap/i, /filenet/i, /sso/i, /oauth/i, /servis/i],
  },
  {
    id: 'nfr',
    label: 'Fonksiyonel olmayan gereksinimler',
    priority: 'medium',
    weight: 5,
    question: 'Performans, güvenlik veya erişilebilirlik açısından özel beklenti var mı?',
    options: ['Performans hedefi', 'Güvenlik / yetki', 'Erişilebilirlik', 'Özel beklenti yok'],
    patterns: [/nfr/i, /performans/i, /g[üu]venlik/i, /eri[şs]ilebilir/i, /sla/i, /yetki/i],
  },
  {
    id: 'risks',
    label: 'Riskler ve varsayımlar',
    priority: 'medium',
    weight: 5,
    question: 'En büyük risk veya varsayım hangisi?',
    options: ['Eksik veri', 'Entegrasyon belirsizliği', 'Kapsam büyümesi', 'Kullanıcı adaptasyonu'],
    patterns: [/risk/i, /varsay[ıi]m/i, /belirsiz/i, /a[çc][ıi]k soru/i, /ba[ğg][ıi]ml[ıi]l[ıi]k/i],
  },
];

const stripHtml = (value = ''): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const sectionText = (section?: SectionData): string => stripHtml(section?.content || '');

const getSender = (message: Message): string => String((message as any).sender || message.role || '').toLowerCase();

const userTexts = (messages: Message[] = []): string => messages
  .filter((m) => getSender(m) === 'user')
  .map((m) => m.text || '')
  .join('\n');

const documentText = (document?: DocumentData | null): string => {
  if (!document) return '';
  return [
    sectionText(document.businessAnalysis),
    sectionText(document.review),
    sectionText(document.code),
    sectionText(document.test),
    sectionText(document.bpmn),
  ].filter(Boolean).join('\n');
};

function countQuestionRounds(messages: Message[] = []): number {
  return messages.filter((m) => getSender(m) === 'ai' || getSender(m) === 'model')
    .filter((m) => Array.isArray((m as any).questions) && (m as any).questions.length > 0)
    .length;
}

function countAnsweredQuestions(messages: Message[] = []): number {
  return messages.reduce((total, m) => {
    if (getSender(m) !== 'user' || typeof m.text !== 'string') return total;
    const markerCount = (m.text.match(/\*\*Soru\s+\d+:\*\*/g) || []).length;
    const answerCount = (m.text.match(/\bCevap\s*:/gi) || []).length;
    return total + Math.max(markerCount, answerCount);
  }, 0);
}

export function isLikelyBaDiscoveryAnswer(message = ''): boolean {
  const text = message.trim();
  if (!text) return false;
  if (/\*\*Soru\s+\d+:\*\*/i.test(text) || /\bCevap\s*:/i.test(text)) return true;
  if (/^(1|q1|soru\s*1)[.)\s:-]/i.test(text)) return true;
  if (text.split(/\n+/).filter((line) => /^\s*\d+[.)-]/.test(line)).length >= 2) return true;
  if (/\b(ev(et)?|hay[ıi]r|şöyle|soyle|aslında|aslinda)\b/i.test(text) && text.length > 30) return true;
  return false;
}

export function buildBaDiscoveryState(input: {
  userMessage?: string;
  messages?: Message[];
  document?: DocumentData | null;
}): BaDiscoveryState {
  const messages = input.messages || [];
  const combined = [input.userMessage || '', userTexts(messages), documentText(input.document)]
    .join('\n')
    .trim();

  const coveredFields = DISCOVERY_FIELDS.filter((field) => field.patterns.some((pattern) => pattern.test(combined)));
  const missingFields = DISCOVERY_FIELDS.filter((field) => !coveredFields.includes(field));
  const maxScore = DISCOVERY_FIELDS.reduce((sum, field) => sum + field.weight, 0);
  const currentScore = coveredFields.reduce((sum, field) => sum + field.weight, 0);
  const readinessScore = Math.round((currentScore / maxScore) * 100);

  return {
    readinessScore,
    coveredFields,
    missingFields,
    criticalMissing: missingFields.filter((field) => field.priority === 'critical'),
    highMissing: missingFields.filter((field) => field.priority === 'high'),
    answeredQuestionCount: countAnsweredQuestions(messages),
    questionRoundCount: countQuestionRounds(messages),
    isLikelyAnswer: isLikelyBaDiscoveryAnswer(input.userMessage || ''),
  };
}

export function buildBaClarifyingQuestions(state: BaDiscoveryState, maxQuestions = 4): Question[] {
  const ranked = [...state.missingFields]
    .sort((a, b) => {
      const priorityScore: Record<BaDiscoveryPriority, number> = { critical: 3, high: 2, medium: 1 };
      return priorityScore[b.priority] - priorityScore[a.priority] || b.weight - a.weight;
    })
    .slice(0, maxQuestions);

  return ranked.map((field, index) => ({
    id: `ba-${field.id}-${index + 1}`,
    text: field.question,
    options: field.options,
  }));
}

export function decideBaDiscovery(input: {
  userMessage: string;
  messages?: Message[];
  document?: DocumentData | null;
  forceGenerate?: boolean;
  stopQuestions?: boolean;
  classifierRequiresClarification?: boolean;
  classifierConfidence?: number;
}): BaDiscoveryDecision {
  const state = buildBaDiscoveryState(input);
  const questions = buildBaClarifyingQuestions(state, 3);

  if (input.forceGenerate) return { shouldAsk: false, reason: 'user_force_generate', state, questions };
  if (input.stopQuestions) return { shouldAsk: false, reason: 'user_stop_questions', state, questions };
  if (state.isLikelyAnswer) return { shouldAsk: false, reason: 'user_answering_discovery', state, questions };
  if (state.answeredQuestionCount >= 6) return { shouldAsk: false, reason: 'answer_budget_satisfied', state, questions };
  if (state.questionRoundCount >= 2) return { shouldAsk: false, reason: 'question_round_cap', state, questions };
  if (questions.length === 0) return { shouldAsk: false, reason: 'no_missing_discovery_fields', state, questions };

  const lowConfidence = typeof input.classifierConfidence === 'number' && input.classifierConfidence < 0.55;
  const shouldAsk = input.classifierRequiresClarification
    || lowConfidence
    || (state.readinessScore < 55 && state.criticalMissing.length >= 2);

  return {
    shouldAsk,
    reason: shouldAsk ? 'ba_discovery_missing_critical_context' : 'ba_discovery_can_continue_with_assumptions',
    state,
    questions,
  };
}

export function buildBaEnginePromptContext(state: BaDiscoveryState): string {
  const missing = state.missingFields.map((field) => field.label).join(', ') || 'Yok';
  const covered = state.coveredFields.map((field) => field.label).join(', ') || 'Yok';
  return [
    '[AI BA ENGINE V1 - BAGLAM]',
    `Keşif hazırlık puanı: ${state.readinessScore}/100`,
    `Toplanan alanlar: ${covered}`,
    `Eksik alanlar: ${missing}`,
    'Kural: Kullanıcı devam/oluştur/varsayımlarla ilerle diyorsa yeni soru sorma; eksikleri [VARSAYIM] olarak dokümana ve Review > Açık Sorular bölümüne yaz.',
  ].join('\n');
}

const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(text));

function scoreSection(label: string, checks: Array<{ label: string; ok: boolean }>): BaQualitySectionScore {
  const passed = checks.filter((check) => check.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    id: label.toLowerCase().replace(/\s+/g, '_'),
    label,
    score,
    status: score >= 75 ? 'pass' : score >= 45 ? 'warn' : 'fail',
    missing: checks.filter((check) => !check.ok).map((check) => check.label),
  };
}

export function evaluateBaQualityV2(document: DocumentData | null | undefined): BaQualityReportV2 {
  const baRaw = document?.businessAnalysis?.content || '';
  const reviewRaw = document?.review?.content || '';
  const ba = sectionText(document?.businessAnalysis);
  const review = sectionText(document?.review);
  const all = `${ba}\n${review}`;
  const sourceSensitive = hasAny(all, [/iys/i, /i[\. ]?y[\. ]?s/i, /mevzuat/i, /kanun/i, /api/i, /oauth/i, /entegrasyon/i]);
  const discovery = buildBaDiscoveryState({ document: document || null });

  if (!document || !ba.trim()) {
    return {
      score: 0,
      canPublish: false,
      summary: 'BA dokümanı henüz üretilebilir seviyede değil.',
      sectionScores: [],
      missingDiscoveryFields: DISCOVERY_FIELDS.map((field) => field.label),
      priorityFixes: ['BA Analiz bölümünü oluştur.', 'Amaç, kapsam, gereksinim ve kabul kriterlerini ekle.'],
      warnings: ['Yayınlanacak BA Analiz içeriği bulunmuyor.'],
    };
  }

  const sectionScores = [
    scoreSection('Keşif ve bağlam', [
      { label: 'Problem / ihtiyaç açık değil', ok: hasAny(all, [/problem/i, /ihtiya[çc]/i, /sorun/i, /uyum/i, /yasal/i, /kanun/i, /cezai/i, /yapt[ıi]r[ıi]m/i]) },
      { label: 'Hedef / iş değeri eksik', ok: hasAny(all, [/ama[çc]/i, /hedef/i, /i[şs] de[ğg]eri/i, /beklenen fayda/i]) },
      { label: 'Paydaş / rol bilgisi eksik', ok: hasAny(all, [/payda[şs]/i, /rol/i, /kat[ıi]l[ıi]mc[ıi]/i]) },
    ]),
    scoreSection('Kapsam ve süreç', [
      { label: 'Kapsam / kapsam dışı eksik', ok: hasAny(all, [/kapsam/i, /kapsam d[ıi][şs][ıi]/i]) },
      { label: 'As-Is / To-Be anlatımı eksik', ok: hasAny(all, [/as[- ]?is/i, /mevcut durum/i]) && hasAny(all, [/to[- ]?be/i, /hedef durum/i]) },
      { label: 'Süreç akışı veya tetikleyici eksik', ok: hasAny(all, [/s[üu]re[çc]/i, /ak[ıi][şs]/i, /tetikleyici/i]) },
    ]),
    scoreSection('Gereksinim kalitesi', [
      { label: 'Kodlanmış fonksiyonel gereksinimler eksik', ok: hasAny(all, [/\bFR[-–]?\d+/i, /fonksiyonel gereksinim/i]) },
      { label: 'İş kuralları eksik', ok: hasAny(all, [/\bBR[-–]?\d+/i, /i[şs] kural/i, /kural/i]) },
      { label: 'Kabul kriterleri eksik', ok: hasAny(all, [/kabul kriter/i, /uat/i, /given|when|then/i]) },
    ]),
    scoreSection('Veri ve entegrasyon', [
      { label: 'Veri modeli / alanları eksik', ok: hasAny(all, [/veri modeli/i, /varl[ıi]k/i, /alan/i, /entity/i]) },
      { label: 'Entegrasyon varsayımı veya kararı eksik', ok: hasAny(all, [/entegrasyon/i, /api/i, /servis/i, /sso/i, /sap/i, /filenet/i]) },
      { label: 'Log / audit / izlenebilirlik eksik', ok: hasAny(all, [/audit/i, /log/i, /izlenebilir/i, /tarih[çc]e/i]) },
    ]),
    scoreSection('NFR ve risk', [
      { label: 'Performans / güvenlik / yetki NFR eksik', ok: hasAny(all, [/nfr/i, /performans/i, /g[üu]venlik/i, /yetki/i]) },
      { label: 'Risk ve varsayım listesi eksik', ok: hasAny(all, [/risk/i, /varsay[ıi]m/i, /ba[ğg][ıi]ml[ıi]l[ıi]k/i]) },
      { label: 'Açık sorular eksik', ok: hasAny(all, [/a[çc][ıi]k soru/i, /eksik bilgi/i]) },
    ]),
    ...(sourceSensitive ? [scoreSection('Kaynak ve doğrulama', [
      { label: 'Doğrulandı / varsayım / açık konu matrisi eksik', ok: hasAny(review, [/kaynak/i, /kan[ıi]t/i]) && hasAny(review, [/DOGRULANDI/i, /DO[ĞG]RULANDI/i, /do[ğg]ruland/i]) && hasAny(review, [/VARSAYIM/i, /varsay[ıi]m/i]) && hasAny(review, [/ACIK KONU/i, /A[ÇC]IK KONU/i, /a[çc][ıi]k konu/i]) },
      { label: 'Resmi kaynak / güvenilir referans notu eksik', ok: hasAny(review, [/resmi kaynak/i, /guvenilir referans/i, /güvenilir referans/i, /mevzuat/i, /api dok[üu]mantasyon/i]) },
      { label: 'Varsayım ve açık konu ayrımı eksik', ok: hasAny(review, [/varsay[ıi]m/i]) && hasAny(review, [/a[çc][ıi]k konu/i, /dogrulama gerek/i, /do[ğg]rulama gerek/i]) },
    ])] : []),
    scoreSection('Kullanılabilirlik ve mesajlar', [
      { label: 'Ekran / kullanıcı etkileşimi eksik', ok: hasAny(all, [/ekran/i, /kullan[ıi]c[ıi] deneyimi/i, /ui/i]) },
      { label: 'Toast / validasyon / modal mesajları eksik', ok: hasAny(all, [/toast/i, /validasyon/i, /modal/i, /uyar[ıi] mesaj/i]) },
      { label: 'Bildirim veya görev takip kuralı eksik', ok: hasAny(all, [/bildirim/i, /hat[ıi]rlatma/i, /görev/i, /gorev/i]) },
    ]),
    scoreSection('Doküman formatı', [
      { label: 'Başlık yapısı eksik', ok: /<h[1-4][\s>]/i.test(baRaw) || /^#{1,4}\s+/m.test(baRaw) },
      { label: 'Tablo formatı eksik', ok: /<table/i.test(baRaw) || /\|\s*[^\n]+\s*\|/.test(baRaw) },
      { label: 'Review kalite notu eksik', ok: review.length > 120 && hasAny(review, [/kalite/i, /risk/i, /a[çc][ıi]k soru/i]) },
    ]),
  ];

  const weightedBase = Math.round(sectionScores.reduce((sum, section) => sum + section.score, 0) / sectionScores.length);
  const lengthPenalty = ba.length < 2500 ? 12 : ba.length < 4500 ? 5 : 0;
  const discoveryPenalty = Math.max(0, Math.min(15, discovery.criticalMissing.length * 3 + discovery.highMissing.length));
  const score = Math.max(0, Math.min(100, weightedBase - lengthPenalty - discoveryPenalty));
  const missingDiscoveryFields = discovery.missingFields.map((field) => field.label);
  const lowSections = sectionScores.filter((section) => section.status !== 'pass');
  const priorityFixes = [
    ...lowSections.flatMap((section) => section.missing.slice(0, 2).map((missing) => `${section.label}: ${missing}`)),
    ...discovery.criticalMissing.map((field) => `Keşif eksiği: ${field.label}`),
  ].slice(0, 8);
  const warnings = [
    ...(ba.length < 2500 ? ['BA Analiz içeriği karar verilebilir detay seviyesinin altında.'] : []),
    ...(discovery.criticalMissing.length > 0 ? [`Kritik keşif alanları eksik: ${discovery.criticalMissing.map((field) => field.label).join(', ')}`] : []),
  ];
  const canPublish = score >= 72 && discovery.criticalMissing.length <= 2 && sectionScores.filter((section) => section.status === 'fail').length <= 1;
  const passedSections = sectionScores.filter((section) => section.status === 'pass').map((section) => section.label).slice(0, 3);
  const lowReason = priorityFixes.slice(0, 3).join('; ') || 'kritik eksik bulunmadı';
  const qualitySummary = canPublish
    ? `Kalite puanı ${score}/100: taslak paylaşılabilir. Güçlü alanlar: ${passedSections.join(', ') || 'temel yapı'}. İyileştirme odağı: ${lowReason}.`
    : `Kalite puanı ${score}/100: revizyon gerekli. Puanı düşüren başlıca alanlar: ${lowReason}. Hızlı aksiyon: eksikleri tamamla ve Review doğrulama matrisini güncelle.`;

  return {
    score,
    canPublish,
    summary: qualitySummary,
    sectionScores,
    missingDiscoveryFields,
    priorityFixes,
    warnings,
  };
}

export function buildBaQualityReviewMarkdown(report: BaQualityReportV2): string {
  const status = report.canPublish ? 'Taslak paylaşılabilir' : 'Revizyon gerekli';
  const rows = report.sectionScores.length
    ? report.sectionScores.map((section) => `| ${section.label} | ${section.score}/100 | ${section.status} | ${section.missing.slice(0, 3).join('; ') || 'Tamam'} |`)
    : ['| BA Analiz | 0/100 | fail | İçerik yok |'];

  return [
    BA_ENGINE_REVIEW_BLOCK_START,
    '## AI BA Engine v1 Kalite Raporu',
    '',
    `**Genel Puan:** ${report.score}/100`,
    `**Durum:** ${status}`,
    `**Özet:** ${report.summary}`,
    '',
    '| Alan | Puan | Durum | Eksik / Zayıf Noktalar |',
    '|---|---:|---|---|',
    ...rows,
    '',
    '### Öncelikli İyileştirmeler',
    ...(report.priorityFixes.length ? report.priorityFixes.map((item) => `- ${item}`) : ['- Kritik iyileştirme bulunmadı.']),
    '',
    '### Eksik Keşif Alanları',
    ...(report.missingDiscoveryFields.length ? report.missingDiscoveryFields.slice(0, 12).map((item) => `- ${item}`) : ['- Kritik keşif eksiği bulunmadı.']),
    '',
    '### Uyarılar',
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ['- Uyarı yok.']),
    BA_ENGINE_REVIEW_BLOCK_END,
  ].join('\n');
}

export function replaceBaEngineReviewBlock(currentContent: string, nextBlock: string): string {
  const current = currentContent || '';
  const escapedStart = BA_ENGINE_REVIEW_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = BA_ENGINE_REVIEW_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) {
    return current.replace(blockRegex, nextBlock);
  }
  return [current.trim(), nextBlock].filter(Boolean).join('\n\n');
}

export function buildBaAnswerMemoryNote(userMessage: string): string | null {
  if (!isLikelyBaDiscoveryAnswer(userMessage)) return null;
  const cleaned = stripHtml(userMessage).slice(0, 1200);
  if (!cleaned) return null;
  return `[BA keşif cevabı] ${cleaned}`;
}
