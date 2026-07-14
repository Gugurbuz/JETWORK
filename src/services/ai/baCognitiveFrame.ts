import type { DocumentData, Question } from '../../types';
import type { SourceIntelligenceReport } from '../sourceIntelligence';
import type { BehaviorDecision } from './behaviorDecision';

export type CognitiveSourceRichness = 'empty' | 'sparse' | 'structured' | 'rich';
export type CognitiveAction =
  | 'ask_first'
  | 'block_until_source'
  | 'draft_source_grounded'
  | 'draft_with_assumptions'
  | 'revise_existing'
  | 'chat_only';

export type ArtifactMode =
  | 'conceptual_analysis'
  | 'process_design'
  | 'user_story'
  | 'acceptance_criteria'
  | 'test_scenario'
  | 'technical_analysis'
  | 'api_specification'
  | 'data_model'
  | 'ui_specification';

export type EvidenceStatus = 'supported' | 'inferred' | 'assumed' | 'conflicting';
export type GapImpact = 'low' | 'medium' | 'high' | 'blocking';
export type GapReversibility = 'easy' | 'moderate' | 'expensive';
export type CoverageStatus = 'covered' | 'partial' | 'missing' | 'not_applicable';

export interface Stakeholder {
  name: string;
  responsibility: string;
  evidenceStatus: EvidenceStatus;
}

export interface ScopeFrame {
  inScope: string[];
  outOfScope: string[];
  assumptions: string[];
}

export interface ConstraintFrame {
  topic: string;
  description: string;
  type: 'business' | 'technical' | 'legal' | 'operational' | 'unknown';
  evidenceStatus: EvidenceStatus;
}

export interface MetricFrame {
  name: string;
  target: string;
  evidenceStatus: EvidenceStatus;
}

export interface ProblemFrame {
  businessProblem: string;
  desiredOutcome: string;
  currentState: string;
  targetState: string;
  stakeholders: Stakeholder[];
  scope: ScopeFrame;
  constraints: ConstraintFrame[];
  successMetrics: MetricFrame[];
}

export interface InformationGap {
  topic: string;
  impact: GapImpact;
  reversibility: GapReversibility;
  canAssume: boolean;
  proposedAssumption?: string;
  question?: string;
  reason: string;
}

export interface EvidenceClaim {
  claim: string;
  sourceId?: string;
  status: EvidenceStatus;
  confidence: number;
  usage: string;
}

export interface CoverageResult {
  status: CoverageStatus;
  required: boolean;
  evidence: string[];
  gapTopics: string[];
}

export interface AnalysisCoverage {
  actors: CoverageResult;
  happyPath: CoverageResult;
  alternateFlows: CoverageResult;
  exceptionFlows: CoverageResult;
  businessRules: CoverageResult;
  validations: CoverageResult;
  permissions: CoverageResult;
  dataRequirements: CoverageResult;
  integrations: CoverageResult;
  nonFunctionalRequirements: CoverageResult;
  reporting: CoverageResult;
  auditability: CoverageResult;
}

export interface CoverageSummary {
  requiredCount: number;
  coveredCount: number;
  partialCount: number;
  missingCount: number;
  score: number;
}

export interface BaCognitiveFrame {
  sourceRichness: CognitiveSourceRichness;
  action: CognitiveAction;
  artifactMode: ArtifactMode;
  confidence: number;
  problemFrame: ProblemFrame;
  evidenceClaims: EvidenceClaim[];
  informationGaps: InformationGap[];
  coverage: AnalysisCoverage;
  coverageSummary: CoverageSummary;
  facts: string[];
  hypotheses: string[];
  missingDecisions: string[];
  outputPlan: string[];
  consistencyChecks: string[];
  reasoningMoves: string[];
  antiPatterns: string[];
  documentContract: string[];
}

export interface BuildBaCognitiveFrameInput {
  userMessage: string;
  recentConversation?: string;
  document: DocumentData | null;
  sourceReport: SourceIntelligenceReport;
  behaviorDecision: BehaviorDecision;
}

const EXPLICIT_ASSUMPTION_CONSENT_RE = /\b(varsayimlarla|varsayimla|mevcut bilgilerle|bu bilgilerle|soru sorma|daha fazla soru sorma|hizli taslak|ilk taslagi|sen yap|devam et|durma)\b/i;
const DOCUMENT_COMMAND_RE = /\b(kavramsal|tasarim|dokuman|rapor|brd|fdd|ba analiz|is analiz|gereksinim|hazirla|olustur|uret|yaz|taslak|cikar)\b/i;

const COVERAGE_KEYS: Array<keyof AnalysisCoverage> = [
  'actors',
  'happyPath',
  'alternateFlows',
  'exceptionFlows',
  'businessRules',
  'validations',
  'permissions',
  'dataRequirements',
  'integrations',
  'nonFunctionalRequirements',
  'reporting',
  'auditability',
];

const REQUIRED_COVERAGE: Record<ArtifactMode, Array<keyof AnalysisCoverage>> = {
  conceptual_analysis: [
    'actors',
    'happyPath',
    'alternateFlows',
    'exceptionFlows',
    'businessRules',
    'validations',
    'permissions',
    'dataRequirements',
    'integrations',
    'nonFunctionalRequirements',
    'reporting',
    'auditability',
  ],
  process_design: [
    'actors',
    'happyPath',
    'alternateFlows',
    'exceptionFlows',
    'businessRules',
    'validations',
    'permissions',
    'reporting',
    'auditability',
  ],
  user_story: [
    'actors',
    'happyPath',
    'businessRules',
    'validations',
    'dataRequirements',
  ],
  acceptance_criteria: [
    'happyPath',
    'alternateFlows',
    'exceptionFlows',
    'businessRules',
    'validations',
  ],
  test_scenario: [
    'happyPath',
    'alternateFlows',
    'exceptionFlows',
    'validations',
    'permissions',
    'dataRequirements',
    'integrations',
  ],
  technical_analysis: [
    'businessRules',
    'validations',
    'permissions',
    'dataRequirements',
    'integrations',
    'nonFunctionalRequirements',
    'auditability',
  ],
  api_specification: [
    'validations',
    'permissions',
    'dataRequirements',
    'integrations',
    'nonFunctionalRequirements',
    'auditability',
  ],
  data_model: [
    'businessRules',
    'validations',
    'dataRequirements',
    'integrations',
    'auditability',
  ],
  ui_specification: [
    'actors',
    'happyPath',
    'alternateFlows',
    'exceptionFlows',
    'businessRules',
    'validations',
    'permissions',
    'dataRequirements',
    'reporting',
  ],
};

function normalizeText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDocument(document: DocumentData | null): boolean {
  if (!document) return false;
  return Object.values(document as any).some((section: any) => section?.content && String(section.content).trim().length > 0);
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

function sourceRichness(report: SourceIntelligenceReport, text: string): CognitiveSourceRichness {
  const signalCount = [
    report.processes.length,
    report.roles.length,
    report.systems.length,
    report.integrations.length,
    report.documentRules.length,
    report.dashboardNeeds.length,
    report.uiNeeds.length,
    report.kpis.length,
    report.risks.length,
    report.openTopics.length,
  ].reduce((sum, value) => sum + value, 0);

  if (!text.trim() && signalCount === 0) return 'empty';
  if (report.processes.length >= 4 || signalCount >= 16 || text.length > 3500) return 'rich';
  if (report.processes.length >= 2 || signalCount >= 7 || text.length > 1200) return 'structured';
  return 'sparse';
}

function detectArtifactMode(text: string, decision: BehaviorDecision): ArtifactMode {
  const normalized = normalizeText(text);
  if (/\b(user story|kullanici hikayesi|story)\b/.test(normalized)) return 'user_story';
  if (/\b(kabul kriter|acceptance criteria|dor|dod)\b/.test(normalized)) return 'acceptance_criteria';
  if (/\b(test senaryo\w*|test case|uat|negatif senaryo\w*|sinir deger)\b/.test(normalized)) return 'test_scenario';
  if (/\b(api spec|swagger|openapi|endpoint|contract)\b/.test(normalized)) return 'api_specification';
  if (/\b(veri modeli|data model|entity|tablo|alan listesi|mapping)\b/.test(normalized)) return 'data_model';
  if (/\b(ui|ux|ekran|wireframe|validasyon|toast|mesaj)\b/.test(normalized)) return 'ui_specification';
  if (/\b(teknik analiz|it analiz|mimari|component|deployment|logging|performans|guvenlik)\b/.test(normalized)) return 'technical_analysis';
  if (/\b(surec tasarim|process design|flow|bpmn|akis)\b/.test(normalized)) return 'process_design';
  if (decision.humanProfile.documentAction !== 'none' || decision.requiredTemplate !== 'none') return 'conceptual_analysis';
  return 'conceptual_analysis';
}

function toStakeholders(report: SourceIntelligenceReport): Stakeholder[] {
  const roles = report.roles.length ? report.roles : ['Is birimi', 'Operasyon', 'IT'];
  return roles.slice(0, 8).map(role => ({
    name: role,
    responsibility: report.roles.length ? 'Kaynakta gecen rol; sorumluluk detaylari dokumanda netlestirilmeli.' : 'Varsayilan paydas; rol/RACI netlestirilmeli.',
    evidenceStatus: report.roles.length ? 'supported' : 'assumed',
  }));
}

function buildProblemFrame(report: SourceIntelligenceReport, decision: BehaviorDecision, richness: CognitiveSourceRichness): ProblemFrame {
  const hasSource = richness === 'rich' || richness === 'structured';
  const processScope = report.processes.map(process => process.title);
  const projectName = report.inferredProjectName || decision.humanProfile.projectDomain.replace(/_/g, ' ');
  const problemFromSignals = [
    report.documentRules.length ? 'dokuman/evrak eksikleri ve kapanis kontrolleri' : '',
    report.integrations.length ? 'sistemler arasi veri ve statu akisi' : '',
    report.dashboardNeeds.length ? 'operasyonel takip ve gorunurluk' : '',
    report.uiNeeds.length ? 'ekran davranislari ve kullanici aksiyonlari' : '',
  ].filter(Boolean).join(', ');

  return {
    businessProblem: hasSource
      ? `${projectName} kapsaminda ${problemFromSignals || 'mevcut is akisi'} karar verilebilir sekilde modellenmeli.`
      : '[ACIK KONU] Asil is problemi kaynakta yeterince acik degil; kullanicinin soyledigi cozum ihtiyac mi, cozum onerisi mi ayrilmali.',
    desiredOutcome: hasSource
      ? 'Surec, rol, veri, ekran, entegrasyon, KPI, risk ve kabul kriterleri izlenebilir bir tasarim omurgasinda birlesmeli.'
      : '[VARSAYIM] Ilk hedef, kavramsal tasarim icin problem ve hedef degeri netlestirmek.',
    currentState: report.processes.length || report.systems.length
      ? `Kaynakta gorunen mevcut omurga: ${uniq([...processScope, ...report.systems]).join(' | ')}.`
      : '[ACIK KONU] Mevcut durum/as-is bilgisi verilmedi.',
    targetState: report.processes.length
      ? `Hedef durum kaynak sureclerin her biri icin tetikleyici, aktor, kural, veri, ekran ve kapanis kriteriyle modellenmis to-be akis.`
      : '[VARSAYIM] Hedef durum, domain icin minimum uygulanabilir surec ve gereksinim taslagi.',
    stakeholders: toStakeholders(report),
    scope: {
      inScope: uniq([
        ...processScope,
        ...report.systems.map(item => `Sistem: ${item}`),
        ...report.integrations.map(item => `Entegrasyon: ${item}`),
        ...report.uiNeeds.map(item => `Ekran/UX: ${item}`),
        ...report.dashboardNeeds.map(item => `Raporlama: ${item}`),
      ]).slice(0, 14),
      outOfScope: [
        '[ACIK KONU] Ilk surum disi kapsam kullanici/is birimi tarafindan onaylanmadi.',
      ],
      assumptions: uniq([
        !report.processes.length ? 'Surec omurgasi domain sinyallerinden turetilecek.' : '',
        !report.roles.length ? 'Rol/RACI detaylari varsayim olarak taslaklanacak.' : '',
        !report.kpis.length ? 'KPI hedef degerleri taslak metrik olarak yazilacak.' : '',
      ]),
    },
    constraints: uniq([
      ...report.openTopics,
      ...report.risks,
      report.mismatchWarnings.length ? report.mismatchWarnings.join(' ') : '',
    ]).slice(0, 8).map(item => ({
      topic: item.slice(0, 80),
      description: item,
      type: /hukuk|mevzuat|kanun|iys/i.test(normalizeText(item)) ? 'legal' : /api|sap|entegrasyon|sistem/i.test(normalizeText(item)) ? 'technical' : 'operational',
      evidenceStatus: 'inferred',
    })),
    successMetrics: (report.kpis.length ? report.kpis : ['Kapsam netlik orani', 'Acik konu kapanma orani']).slice(0, 8).map(metric => ({
      name: metric,
      target: report.kpis.length ? '[ACIK KONU] Hedef esik is birimiyle netlestirilmeli.' : '[VARSAYIM] Ilk taslak icin olcum adayi.',
      evidenceStatus: report.kpis.length ? 'inferred' : 'assumed',
    })),
  };
}

function buildEvidenceClaims(report: SourceIntelligenceReport, richness: CognitiveSourceRichness, artifactMode: ArtifactMode): EvidenceClaim[] {
  const claims: EvidenceClaim[] = [];
  if (report.inferredProjectName) {
    claims.push({
      claim: `Proje konusu ${report.inferredProjectName} olarak algilandi.`,
      sourceId: 'source_intelligence.project',
      status: 'supported',
      confidence: report.confidence,
      usage: 'Proje kimlik karti ve kapsam basligi',
    });
  }
  if (report.processes.length) {
    claims.push({
      claim: `Kaynakta ${report.processes.length} surec omurgasi var: ${report.processes.map(process => process.title).join(' | ')}.`,
      sourceId: 'source_intelligence.processes',
      status: 'supported',
      confidence: Math.min(95, report.confidence + 5),
      usage: 'Surec modeli bloklari',
    });
  } else {
    claims.push({
      claim: 'Surec omurgasi kaynakta acik degil.',
      sourceId: 'source_intelligence.processes',
      status: richness === 'empty' ? 'assumed' : 'inferred',
      confidence: Math.max(20, report.confidence - 20),
      usage: 'Soru veya varsayim karari',
    });
  }
  if (report.systems.length || report.integrations.length) {
    claims.push({
      claim: `Sistem/entegrasyon izleri: ${uniq([...report.systems, ...report.integrations]).join(' | ')}.`,
      sourceId: 'source_intelligence.systems_integrations',
      status: 'inferred',
      confidence: report.confidence,
      usage: 'Teknik kapsam, veri akisi ve hata yonetimi',
    });
  }
  if (report.documentRules.length) {
    claims.push({
      claim: `Dokuman/evrak kurallari tasarimda kapanis kriteri olmalidir: ${report.documentRules.join(' | ')}.`,
      sourceId: 'source_intelligence.document_rules',
      status: 'inferred',
      confidence: report.confidence,
      usage: 'Is kurallari, validasyonlar ve UAT',
    });
  }
  if (report.kpis.length || report.dashboardNeeds.length) {
    claims.push({
      claim: `Olcumleme/raporlama izleri: ${uniq([...report.kpis, ...report.dashboardNeeds]).join(' | ')}.`,
      sourceId: 'source_intelligence.metrics_reporting',
      status: report.kpis.length ? 'inferred' : 'assumed',
      confidence: report.confidence,
      usage: 'KPI ve raporlama',
    });
  }
  if (report.mismatchWarnings.length) {
    claims.push({
      claim: `Baglam celiskisi tespit edildi: ${report.mismatchWarnings.join(' ')}`,
      sourceId: 'source_intelligence.mismatch',
      status: 'conflicting',
      confidence: 90,
      usage: 'Uretim oncesi baglam onceligi',
    });
  }
  claims.push({
    claim: `Cikti modu ${artifactMode} olarak belirlendi.`,
    sourceId: 'cognitive.artifact_mode',
    status: 'inferred',
    confidence: 70,
    usage: 'Coverage politikasi ve dokuman kontrati',
  });
  return claims.slice(0, 12);
}

function gap(
  topic: string,
  impact: GapImpact,
  reversibility: GapReversibility,
  canAssume: boolean,
  proposedAssumption: string,
  question: string,
  reason: string,
): InformationGap {
  return { topic, impact, reversibility, canAssume, proposedAssumption, question, reason };
}

function buildInformationGaps(report: SourceIntelligenceReport, richness: CognitiveSourceRichness, decision: BehaviorDecision, artifactMode: ArtifactMode): InformationGap[] {
  const gaps: InformationGap[] = [];
  const needsDocument = decision.requiredTemplate !== 'none';
  if (richness === 'empty' && needsDocument) {
    gaps.push(gap(
      'Minimum kaynak / problem tanimi',
      'blocking',
      'expensive',
      false,
      '',
      'Bu talepte cozulmek istenen asil is problemi ve hedef sonuc nedir?',
      'Kaynak yokken uretilen dokuman yuksek ihtimalle generic olur.',
    ));
  }
  if (!report.processes.length && needsDocument) {
    gaps.push(gap(
      'Ana surec modeli ve tetikleyici sirasi',
      'high',
      'expensive',
      false,
      'Domain pratiklerine gore 3-5 sureclik taslak omurga olusturulur ve [VARSAYIM] etiketiyle yazilir.',
      'Ana surec hangi tetikleyiciyle baslar, hangi asamalardan gecer ve hangi kosulda kapanir?',
      'Surec omurgasi yanlis kurulursa gereksinim, ekran, test ve entegrasyon da yanlis sekillenir.',
    ));
  }
  if (!report.roles.length && needsDocument) {
    gaps.push(gap(
      'Rol/RACI ve karar sahipleri',
      'medium',
      'moderate',
      true,
      'Is birimi, operasyon ve IT rolleri varsayilir; kesin RACI acik konu olarak birakilir.',
      'Surecte karar veren, onaylayan ve operasyonu yurutun roller kimlerdir?',
      'Rol eksigi yetki, bildirim ve onay akislarini etkiler ama taslakta isaretlenerek ilerlenebilir.',
    ));
  }
  if (!report.systems.length && ['conceptual_analysis', 'technical_analysis', 'api_specification', 'data_model'].includes(artifactMode)) {
    gaps.push(gap(
      'Kaynak/hedef sistemler ve veri sahipligi',
      'high',
      'expensive',
      false,
      'Sistemler domain baglamina gore aday olarak yazilir, kesin entegrasyon karari acik konu olur.',
      'Kaynak sistem, hedef sistem ve ana veri sahibi hangi uygulamadir?',
      'Sistem sahipligi yanlis varsayilirsa entegrasyon ve veri modeli pahali sekilde yeniden tasarlanir.',
    ));
  }
  if (!report.integrations.length && ['technical_analysis', 'api_specification', 'conceptual_analysis'].includes(artifactMode) && decision.shouldUseResearch) {
    gaps.push(gap(
      'Entegrasyon modeli ve hata davranisi',
      'high',
      'expensive',
      false,
      'Senkron/asenkron karari [ACIK KONU] yapilir; retry, audit ve monitoring taslaklanir.',
      'Entegrasyon senkron mu, asenkron mu, batch mi calismali; hata ve retry sorumlulugu kimde?',
      'Entegrasyon karari performans, UX, veri tutarliligi ve operasyon sorumlulugunu degistirir.',
    ));
  }
  if (!report.documentRules.length && ['conceptual_analysis', 'process_design'].includes(artifactMode)) {
    gaps.push(gap(
      'Zorunlu dokuman/evrak ve versiyon kurallari',
      'high',
      'expensive',
      false,
      'Zorunlu evrak matrisi taslaklanir ve kesin liste acik konu olarak birakilir.',
      'Hangi belge/evrak olmadan surec ilerleyemez veya kapanamaz?',
      'Belge kurali yanlis ise surec kapanisi, audit ve yasal izlenebilirlik bozulur.',
    ));
  }
  if (!report.uiNeeds.length && ['ui_specification', 'conceptual_analysis'].includes(artifactMode)) {
    gaps.push(gap(
      'Ekran davranislari, validasyon ve kullanici mesajlari',
      'medium',
      'moderate',
      true,
      'Kritik alanlar icin zorunlu alan, toast ve hata mesajlari taslaklanir.',
      'Kullanici hangi ekranda hangi aksiyonu alacak; hangi durumda nasil uyarilacak?',
      'UX eksigi revize edilebilir ama kabul kriterlerinin kalitesini dusurur.',
    ));
  }
  if (!report.kpis.length && ['conceptual_analysis', 'process_design'].includes(artifactMode)) {
    gaps.push(gap(
      'Basari KPI ve olcum formulleri',
      'medium',
      'moderate',
      true,
      'SLA, hata orani, acik konu kapanma suresi gibi aday KPIlar [VARSAYIM] olarak yazilir.',
      'Basari hangi metriklerle ve hangi hedef esikle olculecek?',
      'KPI olmadan dokuman uygulanabilir ama is degeri ve kabul netligi zayif kalir.',
    ));
  }
  if (artifactMode === 'test_scenario' && !report.uiNeeds.length && !report.processes.length) {
    gaps.push(gap(
      'Test on kosullari ve test verisi',
      'blocking',
      'moderate',
      false,
      '',
      'Test edilecek ana akis, on kosul ve test verisi nedir?',
      'Akis ve veri olmadan test senaryosu gercek davranisi dogrulayamaz.',
    ));
  }
  return gaps;
}

function result(required: boolean, evidence: string[], gapTopics: string[]): CoverageResult {
  if (!required) return { status: 'not_applicable', required, evidence: [], gapTopics: [] };
  if (evidence.length >= 2) return { status: 'covered', required, evidence, gapTopics };
  if (evidence.length === 1) return { status: 'partial', required, evidence, gapTopics };
  return { status: 'missing', required, evidence: [], gapTopics };
}

function buildCoverage(report: SourceIntelligenceReport, artifactMode: ArtifactMode): AnalysisCoverage {
  const required = new Set(REQUIRED_COVERAGE[artifactMode]);
  const isRequired = (key: keyof AnalysisCoverage): boolean => required.has(key);
  const processTitles = report.processes.map(process => process.title);
  const legalSignals = uniq([
    ...report.roles.filter(item => /hukuk|legal/i.test(normalizeText(item))),
    ...report.documentRules.filter(item => /hukuk|dava|ihtar|sozlesme/i.test(normalizeText(item))),
  ]);

  return {
    actors: result(isRequired('actors'), report.roles, ['Rol/RACI']),
    happyPath: result(isRequired('happyPath'), processTitles, ['Ana akis']),
    alternateFlows: result(isRequired('alternateFlows'), report.processes.length > 1 ? processTitles.slice(1, 4) : [], ['Alternatif akislar']),
    exceptionFlows: result(isRequired('exceptionFlows'), uniq([...report.risks, ...report.openTopics]), ['Istisna/negatif senaryolar']),
    businessRules: result(isRequired('businessRules'), uniq([...report.documentRules, ...processTitles.slice(0, 3)]), ['Is kurallari']),
    validations: result(isRequired('validations'), uniq([...report.uiNeeds, ...report.documentRules]), ['Validasyonlar ve mesajlar']),
    permissions: result(isRequired('permissions'), uniq([...report.roles, ...legalSignals]), ['Yetki kurallari']),
    dataRequirements: result(isRequired('dataRequirements'), uniq([...report.systems, ...report.documentRules, ...report.kpis]), ['Veri gereksinimleri']),
    integrations: result(isRequired('integrations'), uniq([...report.integrations, ...report.systems]), ['Entegrasyonlar']),
    nonFunctionalRequirements: result(isRequired('nonFunctionalRequirements'), uniq([...report.risks, ...report.integrations]), ['NFR']),
    reporting: result(isRequired('reporting'), uniq([...report.dashboardNeeds, ...report.kpis]), ['Raporlama/KPI']),
    auditability: result(isRequired('auditability'), uniq([...report.documentRules, ...legalSignals, ...report.risks]), ['Audit/log/izlenebilirlik']),
  };
}

function summarizeCoverage(coverage: AnalysisCoverage): CoverageSummary {
  const rows = COVERAGE_KEYS.map(key => coverage[key]).filter(row => row.required);
  const coveredCount = rows.filter(row => row.status === 'covered').length;
  const partialCount = rows.filter(row => row.status === 'partial').length;
  const missingCount = rows.filter(row => row.status === 'missing').length;
  const requiredCount = rows.length;
  const score = requiredCount
    ? Math.round(((coveredCount + partialCount * 0.5) / requiredCount) * 100)
    : 100;
  return { requiredCount, coveredCount, partialCount, missingCount, score };
}

function buildFacts(report: SourceIntelligenceReport, problemFrame: ProblemFrame): string[] {
  return uniq([
    report.inferredProjectName ? `Proje izleri: ${report.inferredProjectName}` : '',
    `Problem frame: ${problemFrame.businessProblem}`,
    report.processes.length ? `Kaynak surecler: ${report.processes.map(process => process.title).join(' | ')}` : '',
    report.roles.length ? `Roller/paydaslar: ${report.roles.join(' | ')}` : '',
    report.systems.length ? `Sistemler: ${report.systems.join(' | ')}` : '',
    report.integrations.length ? `Entegrasyon izleri: ${report.integrations.join(' | ')}` : '',
    report.documentRules.length ? `Dokuman/evrak kurallari: ${report.documentRules.join(' | ')}` : '',
    report.dashboardNeeds.length ? `Dashboard ihtiyaclari: ${report.dashboardNeeds.join(' | ')}` : '',
    report.uiNeeds.length ? `Ekran/UX izleri: ${report.uiNeeds.join(' | ')}` : '',
    report.kpis.length ? `KPI izleri: ${report.kpis.join(' | ')}` : '',
  ]).slice(0, 12);
}

function buildHypotheses(report: SourceIntelligenceReport, decision: BehaviorDecision, artifactMode: ArtifactMode): string[] {
  const hypotheses = [
    `Kullanici niyeti hipotezi: ${decision.humanProfile.userIntent}`,
    `Cikti modu hipotezi: ${artifactMode}`,
    `Dokuman aksiyonu hipotezi: ${decision.humanProfile.documentAction}`,
    `Varsayim politikasi hipotezi: ${decision.humanProfile.assumptionPolicy}`,
  ];
  if (report.domainHints.length) hypotheses.push(`Domain hipotezi: ${report.domainHints.join(' | ')}`);
  if (!report.processes.length) hypotheses.push('Surec modeli kaynakta acik degil; talepteki rol, ekran, veri, gorev ve rapor sinyallerinden turetilmeli.');
  if (report.mismatchWarnings.length) hypotheses.push(`Baglam celiskisi olabilir: ${report.mismatchWarnings.join(' | ')}`);
  return uniq(hypotheses).slice(0, 10);
}

function explicitAssumptionConsent(input: BuildBaCognitiveFrameInput): boolean {
  return EXPLICIT_ASSUMPTION_CONSENT_RE.test(normalizeText([input.userMessage, input.recentConversation || ''].join('\n')));
}

function decideCognitiveAction(
  input: BuildBaCognitiveFrameInput,
  richness: CognitiveSourceRichness,
  artifactMode: ArtifactMode,
  gaps: InformationGap[],
): CognitiveAction {
  if (input.behaviorDecision.mode === 'chat_only' || input.behaviorDecision.requiredTemplate === 'none') return 'chat_only';
  if (hasDocument(input.document)) return 'revise_existing';
  if (richness === 'rich' || richness === 'structured') return 'draft_source_grounded';
  const hasConsent = explicitAssumptionConsent(input);
  const blockingGaps = gaps.filter(item => item.impact === 'blocking' && !item.canAssume);
  const expensiveHighGaps = gaps.filter(item => item.impact === 'high' && item.reversibility === 'expensive' && !item.canAssume);
  const normalizedText = normalizeText([input.userMessage, input.recentConversation || ''].join('\n'));

  if (blockingGaps.length && !hasConsent) return 'block_until_source';
  if (expensiveHighGaps.length && !hasConsent) return 'ask_first';
  if (hasConsent) return 'draft_with_assumptions';
  if (input.behaviorDecision.mode === 'ask_clarifying_questions') return 'ask_first';
  if (richness === 'sparse' && (DOCUMENT_COMMAND_RE.test(normalizedText) || input.behaviorDecision.shouldUpdateDocument || artifactMode !== 'conceptual_analysis')) {
    return 'ask_first';
  }
  return input.behaviorDecision.shouldUpdateDocument ? 'draft_with_assumptions' : 'chat_only';
}

function buildOutputPlan(artifactMode: ArtifactMode): string[] {
  const plans: Record<ArtifactMode, string[]> = {
    conceptual_analysis: [
      'ProblemFrame: is problemi, hedef sonuc, as-is/to-be, paydaslar ve kapsam.',
      'Surec modelleri: her ana surec icin tetikleyici, aktor, adim, karar, istisna, kapanis.',
      'Gereksinimler: BR/FR/NFR/INT/RPT/SEC kodlu, kaynak/varsayim etiketiyle.',
      'Review: dogrulandi / varsayim / acik konu, riskler ve hizli aksiyonlar.',
    ],
    process_design: [
      'Surec omurgasi ve aktor swimlane mantigi.',
      'Happy path, alternatif akis, istisna akis ve durum gecisleri.',
      'Is kurallari, validasyonlar, yetki ve bildirim davranislari.',
    ],
    user_story: [
      'Persona, hedef, is degeri.',
      'Acceptance criteria, dependency, DoR/DoD.',
      'Acilacak sorular ve varsayimlar.',
    ],
    acceptance_criteria: [
      'Given/When/Then kabul kriterleri.',
      'Pozitif, negatif, sinir ve yetki senaryolari.',
      'Acik veri/on kosul karar listesi.',
    ],
    test_scenario: [
      'On kosul, test verisi, adimlar ve beklenen sonuc.',
      'Negatif, alternatif, sinir deger ve entegrasyon hata senaryolari.',
      'UAT kabul ve regression notlari.',
    ],
    technical_analysis: [
      'Component, API/servis, veri modeli ve entegrasyon sorumluluklari.',
      'Hata/retry/logging/audit/guvenlik/performans/deployment.',
      'Kod veya sistem degisikligi varsa dogrulama/test plani.',
    ],
    api_specification: [
      'Endpoint, request/response, auth, hata kodlari.',
      'Idempotency, rate limit, retry, audit ve monitoring.',
      'Sozlesme testleri ve versiyonlama.',
    ],
    data_model: [
      'Entity, alan, tip, zorunluluk, sahiplik ve lifecycle.',
      'Mapping, validation, migration ve audit.',
      'Raporlama/KPI veri kaynagi.',
    ],
    ui_specification: [
      'Ekran amaci, persona, aksiyonlar ve state model.',
      'Form alanlari, validasyon, toast/modal/bildirim mesajlari.',
      'Yetki, bos durum, hata durumu ve erisilebilirlik.',
    ],
  };
  return plans[artifactMode];
}

function buildConsistencyChecks(artifactMode: ArtifactMode): string[] {
  const base = [
    'Problem ile onerilen cozum ayni sey mi, yoksa kullanici cozum isteyip ihtiyaci gizli mi bir daha kontrol et.',
    'Her kritik iddia icin supported / inferred / assumed / conflicting durumunu belirt.',
    'Yuksek etkili ve geri donusu pahali bosluklari sessizce varsayma.',
    'Cikti coverage tablosundaki eksikleri Review acik konularina tasir.',
    'Dokuman kod, kaynak ve onceki sohbetle celisirse celiskiyi gizleme.',
  ];
  if (['technical_analysis', 'api_specification'].includes(artifactMode)) {
    base.push('Kod veya teknik uygulanabilirlik iddiasi varsa test/build/log dogrulamasini ayri belirt.');
  }
  if (artifactMode === 'test_scenario') {
    base.push('Test senaryolarinda on kosul, test verisi ve beklenen sonuc yoksa test tamam sayilmaz.');
  }
  return base;
}

function buildReasoningMoves(action: CognitiveAction, richness: CognitiveSourceRichness, artifactMode: ArtifactMode): string[] {
  const moves = [
    'Talebi dokuman komutu olarak degil, problem-cozum-fit konusu olarak oku.',
    'Once ProblemFrame kur: is problemi, hedef sonuc, as-is, to-be, paydas, kapsam, kisit, KPI.',
    'Kaynak iddialarini EvidenceClaim olarak ayir: supported, inferred, assumed, conflicting.',
    'Eksik bilgileri InformationGap matrisiyle degerlendir: etki, geri donus maliyeti, varsayilabilirlik.',
    `ArtifactMode=${artifactMode} icin coverage politikasini uygula.`,
    'Dokumani yazmadan once surec omurgasini kur; sonra gereksinim, ekran, veri, entegrasyon ve UAT detaylarini bagla.',
  ];
  if (action === 'ask_first' || action === 'block_until_source') moves.push('Soru soruyorsan genel BA sorulari degil, yuksek etkili/pahali karar bosluklarini sor.');
  if (action === 'draft_source_grounded') moves.push('Kaynak zengin oldugu icin soru sormadan once kaynak omurgasini isleyerek taslak uret.');
  if (richness === 'rich') moves.push('Uzun talep dokumaninda ozet yapip gecme; kaynak sureclerinin tamamini izlenebilir gereksinime donustur.');
  return moves;
}

function buildAntiPatterns(report: SourceIntelligenceReport): string[] {
  return uniq([
    'Sadece sablon basliklarini doldurup gecme.',
    'Kullanici cozum soyledi diye bunun gercek ihtiyac oldugunu varsayma; problem-cozum ayrimini yap.',
    'Kaynakta olmayan sistem, mikroservis, teknoloji veya ekran adini kesin bilgi gibi yazma.',
    'Her eksige soru sorma; dusuk etkili ve kolay geri donen bosluklari isaretli varsayimla ilerlet.',
    'Yuksek etkili ve pahali kararlari sessizce varsayma.',
    'Kaliteyi uzunluk, tablo veya baslik sayisiyla olcme; kaynak talebin karsilanma ve coverage oraniyla olc.',
    'Genel "Ana is sureci" veya "Kaynak Sistemden Hedef Sisteme Veri Aktarimi" basliklarini kaynak sureclerin yerine kullanma.',
    report.processes.length ? 'Kaynakta acik surecler varsa bunlari kisaltip uc generic surece indirme.' : '',
    report.mismatchWarnings.length ? 'Workspace basligi ile kaynak talep celisirse kaynak talebi ana gerceklik kabul et.' : '',
  ]);
}

function buildDocumentContract(report: SourceIntelligenceReport, artifactMode: ArtifactMode): string[] {
  return uniq([
    `Cikti modu ${artifactMode}; bolumler ve coverage bu moda gore uretilmelidir.`,
    'businessAnalysis karar verilebilir kavramsal tasarim olmalidir: surec, rol, ekran, veri, entegrasyon, KPI, risk ve UAT bagli yazilir.',
    'review kalite raporu olmalidir: dogrulandi / varsayim / acik konu ayrimi, riskler, coverage eksikleri ve hizli aksiyonlar.',
    'Her kritik karar satirinda kaynak durumu yaz: [DOGRULANDI], [CIKARIM], [VARSAYIM], [CELISKI], [ACIK KONU].',
    report.processes.length ? `Her kaynak surec icin ayri "SUREC MODELI - N" blogu ac: ${report.processes.map(process => process.title).join(' | ')}` : '',
    report.documentRules.length ? 'Zorunlu evrak ve dokuman kurallari surec kapanis kriteri olarak yazilir.' : '',
    report.dashboardNeeds.length ? 'Dashboard, deadline, gecikme ve acik gorev ihtiyaclari raporlama/KPI bolumune baglanir.' : '',
    report.integrations.length ? 'Entegrasyonlar icin kaynak, hedef, tetikleyici, basari/hata davranisi ve audit yazilir.' : '',
  ]);
}

function renderList(items: string[], fallback: string): string {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`;
}

function renderCoverage(coverage: AnalysisCoverage): string {
  return COVERAGE_KEYS.map(key => {
    const row = coverage[key];
    if (!row.required) return `- ${key}: not_applicable`;
    return `- ${key}: ${row.status}; evidence=${row.evidence.slice(0, 3).join(' | ') || '[YOK]'}; gap=${row.gapTopics.join(' | ') || '[YOK]'}`;
  }).join('\n');
}

function renderGaps(gaps: InformationGap[]): string {
  if (!gaps.length) return '- Kritik bilgi boslugu gorunmuyor.';
  return gaps.slice(0, 10).map(item => (
    `- ${item.topic}: impact=${item.impact}, reversibility=${item.reversibility}, canAssume=${item.canAssume ? 'yes' : 'no'}; reason=${item.reason}; assumption=${item.proposedAssumption || '[YOK]'}`
  )).join('\n');
}

function renderClaims(claims: EvidenceClaim[]): string {
  return claims.length
    ? claims.map(item => `- ${item.status.toUpperCase()}: ${item.claim} (confidence=${item.confidence}/100, usage=${item.usage})`).join('\n')
    : '- Kanit iddiasi yok.';
}

function renderProblemFrame(problem: ProblemFrame): string {
  return [
    `- businessProblem: ${problem.businessProblem}`,
    `- desiredOutcome: ${problem.desiredOutcome}`,
    `- currentState: ${problem.currentState}`,
    `- targetState: ${problem.targetState}`,
    `- stakeholders: ${problem.stakeholders.map(item => `${item.name}(${item.evidenceStatus})`).join(' | ') || '[YOK]'}`,
    `- inScope: ${problem.scope.inScope.join(' | ') || '[ACIK KONU]'}`,
    `- assumptions: ${problem.scope.assumptions.join(' | ') || '[YOK]'}`,
    `- successMetrics: ${problem.successMetrics.map(item => `${item.name}(${item.evidenceStatus})`).join(' | ') || '[YOK]'}`,
  ].join('\n');
}

export function buildBaCognitiveFrame(input: BuildBaCognitiveFrameInput): BaCognitiveFrame {
  const sourceText = [input.userMessage, input.recentConversation || ''].filter(Boolean).join('\n\n');
  const richness = sourceRichness(input.sourceReport, sourceText);
  const artifactMode = detectArtifactMode(sourceText, input.behaviorDecision);
  const problemFrame = buildProblemFrame(input.sourceReport, input.behaviorDecision, richness);
  const evidenceClaims = buildEvidenceClaims(input.sourceReport, richness, artifactMode);
  const informationGaps = buildInformationGaps(input.sourceReport, richness, input.behaviorDecision, artifactMode);
  const coverage = buildCoverage(input.sourceReport, artifactMode);
  const coverageSummary = summarizeCoverage(coverage);
  const action = decideCognitiveAction(input, richness, artifactMode, informationGaps);
  const facts = buildFacts(input.sourceReport, problemFrame);
  const hypotheses = buildHypotheses(input.sourceReport, input.behaviorDecision, artifactMode);
  const missingDecisions = informationGaps.map(item => item.topic);
  const confidenceBase = input.sourceReport.confidence;
  const confidence = Math.max(
    20,
    Math.min(
      95,
      confidenceBase
        + (facts.length * 2)
        + Math.round(coverageSummary.score / 8)
        - (informationGaps.filter(item => item.impact === 'high').length * 8)
        - (informationGaps.filter(item => item.impact === 'blocking').length * 18),
    ),
  );

  return {
    sourceRichness: richness,
    action,
    artifactMode,
    confidence,
    problemFrame,
    evidenceClaims,
    informationGaps,
    coverage,
    coverageSummary,
    facts,
    hypotheses,
    missingDecisions,
    outputPlan: buildOutputPlan(artifactMode),
    consistencyChecks: buildConsistencyChecks(artifactMode),
    reasoningMoves: buildReasoningMoves(action, richness, artifactMode),
    antiPatterns: buildAntiPatterns(input.sourceReport),
    documentContract: buildDocumentContract(input.sourceReport, artifactMode),
  };
}

export function buildBaCognitiveInstruction(frame: BaCognitiveFrame): string {
  return `
[AI AKLI / BILISSEL MODEL - ZORUNLU]
Bu katman sablon doldurmak icin degil, cevabi uretmeden once kurulacak is analizi ve vibe-coding zihinsel modelidir.

Kaynak zenginligi: ${frame.sourceRichness}
ArtifactMode: ${frame.artifactMode}
Onerilen aksiyon: ${frame.action}
Guven skoru: ${frame.confidence}/100
Coverage skoru: ${frame.coverageSummary.score}/100 (${frame.coverageSummary.coveredCount} covered, ${frame.coverageSummary.partialCount} partial, ${frame.coverageSummary.missingCount} missing)

ProblemFrame:
${renderProblemFrame(frame.problemFrame)}

EvidenceClaim listesi:
${renderClaims(frame.evidenceClaims)}

InformationGap matrisi:
${renderGaps(frame.informationGaps)}

Coverage kontrolu:
${renderCoverage(frame.coverage)}

Kesin bilgi olarak kullanilacak kaynak izleri:
${renderList(frame.facts, 'Kaynakta yeterli kesin iz yok; kesin olmayanlari varsayim olarak ayir.')}

Hipotezler:
${renderList(frame.hypotheses, 'Hipotez yok.')}

Zihinsel islem sirasi:
${renderList(frame.reasoningMoves, 'Once anla, sonra uret.')}

Cikti plani:
${renderList(frame.outputPlan, 'Cikti plani yok.')}

Tutarlilik kontrolleri:
${renderList(frame.consistencyChecks, 'Tutarlilik kontrolu yok.')}

Kacinilacak tekduze davranislar:
${renderList(frame.antiPatterns, 'Genel sablon cevabi verme.')}

Dokuman kontrati:
${renderList(frame.documentContract, 'Dokuman kaynak talebe bagli ve karar verilebilir olmalidir.')}

Uygulama kurallari:
- Cevapta veya dokumanda kaynakta olmayan seyi DOGRULANDI gibi yazma.
- Bir bilgi tahminse [VARSAYIM], cikarimsa [CIKARIM], karar gerekiyorsa [ACIK KONU], kaynakta aciksa [DOGRULANDI], celiski varsa [CELISKI] olarak ayir.
- Soru soracaksan soru gerekcesi InformationGap impact/reversibility degerine bagli olmali; genel BA sorusu sorma.
- Dusuk etkili ve kolay geri donen bosluklari isaretli varsayimla ilerlet; yuksek etkili ve pahali bosluklari sessizce varsayma.
- Dokuman uretirken once ProblemFrame ve kaynak omurgasini kur, sonra artifact mode sozlesmesini uygula.
- Teknik/kod iddiasi varsa "calisir" deme; build/test/log/dogrulama kaniti yoksa [DOGRULAMA GEREKIR] olarak yaz.
`.trim();
}

export function buildBaCognitiveQuestions(frame: BaCognitiveFrame): string[] {
  return buildBaCognitiveQuestionItems(frame).map((question) => (
    `${question.text}\nSecenekler: ${question.options.join(' | ')}`
  ));
}

function rankedQuestionGaps(frame: BaCognitiveFrame): InformationGap[] {
  const highValueGaps = frame.informationGaps
    .filter(item => !item.canAssume || item.impact === 'blocking' || item.impact === 'high')
    .sort((a, b) => {
      const impactRank: Record<GapImpact, number> = { blocking: 4, high: 3, medium: 2, low: 1 };
      const reversibilityRank: Record<GapReversibility, number> = { expensive: 3, moderate: 2, easy: 1 };
      return ((impactRank[b.impact] * 10) + reversibilityRank[b.reversibility])
        - ((impactRank[a.impact] * 10) + reversibilityRank[a.reversibility]);
    });

  return highValueGaps.length
    ? highValueGaps
    : [{
      topic: 'Ana is problemi, hedef deger ve ilk surum kapsami',
      impact: 'high' as GapImpact,
      reversibility: 'expensive' as GapReversibility,
      canAssume: false,
      proposedAssumption: '',
      question: 'Asil is problemi, beklenen hedef deger ve ilk surum kapsami nedir?',
      reason: 'Bu karar netlesmeden dokuman generic ve uydurma gorunebilir.',
    }];
}

function optionText(value = ''): string {
  const cleaned = value
    .replace(/^\[(VARSAYIM|ACIK KONU|DOGRULANDI|CIKARIM)\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 84) return cleaned;
  return `${cleaned.slice(0, 81).trim()}...`;
}

function questionOptionsForGap(gap: InformationGap, index: number): string[] {
  const topic = normalizeText(`${gap.topic} ${gap.question || ''}`);
  const proposed = gap.proposedAssumption ? optionText(gap.proposedAssumption) : '';
  const defaultDecision = index === 0 ? 'Once bunu netlestirelim' : 'Bu karar acik konu kalsin';
  const assumption = proposed || 'Varsayimlarla ilerle';

  if (/problem|hedef|kapsam|minimum kaynak/.test(topic)) {
    return [
      'Uyum/risk azaltma',
      'Gelir veya satis verimliligi',
      'Operasyonel hiz ve kalite',
      'Varsayimlarla ilerle',
    ];
  }
  if (/surec|akis|omurga|tetikleyici|baslar|asama/.test(topic)) {
    return [
      'Kullanici baslatir, sistem kontrollu ilerler',
      'Sistem/API baslatir, operasyon izler',
      'Manuel onayli operasyon akisi',
      'Varsayimla surec omurgasi kur',
    ];
  }
  if (/rol|raci|karar sahibi|onaylayan/.test(topic)) {
    return [
      'Is birimi karar verir, IT uygular',
      'Operasyon yurutur, yonetici onaylar',
      'Rol/RACI acik konu kalsin',
      'Varsayimla standart roller',
    ];
  }
  if (/sistem|veri sahibi|kaynak|hedef/.test(topic)) {
    return [
      'SAP/CRM kaynak sistem',
      'Harici servis/API hedef sistem',
      'Veri sahipligi acik konu',
      'Varsayimla sistemleri ayir',
    ];
  }
  if (/entegrasyon|senkron|asenkron|batch|retry/.test(topic)) {
    return [
      'Senkron API',
      'Asenkron kuyruk/delta',
      'Batch/dosya aktarimi',
      'Karar acik konu kalsin',
    ];
  }
  if (/dokuman|evrak|belge|versiyon/.test(topic)) {
    return [
      'Zorunlu belge olmadan ilerlemesin',
      'Eksik belge uyarisi ile devam etsin',
      'Belge kurallari acik konu',
      'Varsayimla evrak matrisi',
    ];
  }
  if (/ekran|validasyon|mesaj|uyari|kullanici/.test(topic)) {
    return [
      'Form + liste + detay ekrani',
      'Operasyon is listesi yeterli',
      'Validasyon/toast varsayimla yazilsin',
      'UI davranisi acik konu',
    ];
  }
  if (/kpi|basari|olcum|metrik/.test(topic)) {
    return [
      'SLA/sure odakli KPI',
      'Hata orani/kalite KPI',
      'Is yuku/otomasyon KPI',
      'KPI acik konu kalsin',
    ];
  }
  if (/test|kosul|veri/.test(topic)) {
    return [
      'Ana akis + pozitif test',
      'Negatif/istisna testleri dahil',
      'Test verisi acik konu',
      'Varsayimla UAT seti',
    ];
  }

  return Array.from(new Set([
    assumption,
    defaultDecision,
    'Acik konu olarak yaz',
    'Kapsam disi birak',
  ].filter(Boolean))).slice(0, 4);
}

export function buildBaCognitiveQuestionItems(frame: BaCognitiveFrame, maxQuestions = 4): Question[] {
  const gaps = rankedQuestionGaps(frame);

  return gaps.slice(0, maxQuestions).map((item, index) => {
    const questionText = item.question || `${item.topic} nasil ele alinmali?`;
    const impact = `Karar etkisi: ${item.reason} Etki=${item.impact}, geri donus=${item.reversibility}.`;
    return {
      id: `q${index + 1}`,
      text: `${questionText}\n${impact}`,
      options: questionOptionsForGap(item, index),
    };
  });
}
