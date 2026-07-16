import type { Question } from '../../types';
import { BA_MINDSET_SYSTEM_INSTRUCTION } from '../../services/ai/baMindset';
import {
  actInstructionsForSource,
  hasDomainProfile,
  preferredSourcesForSource,
  requiresExternalResearchForSource,
  researchQueriesForSource,
  sourceSensitiveForSource,
} from '../../services/domainProfiles';

export interface DeepBaResearchPlan {
  enabled: boolean;
  reason: string;
  searchQueries: string[];
  assumptions: string[];
  documentGapsToCheck: string[];
}

export interface SourceVerificationPolicy {
  requiresSourceSeparation: boolean;
  preferredSources: string[];
  statusLabels: ['DOGRULANDI', 'VARSAYIM', 'ACIK KONU'];
  reviewMatrixColumns: string[];
}

const TOPIC_RESEARCH_TRIGGERS = [
  /sap/i,
  /\bcrm\b/i,
  /\biys\b|i[\. ]?y[\. ]?s|ileti y[oö]netim sistemi|ileti yonetim sistemi/i,
  /kvkk|gdpr|mevzuat|y[oö]netmelik|kanun|uyum/i,
  /api|entegrasyon|integration|middleware|oauth|sso/i,
  /e[- ]?(fatura|ar[şs]iv|arsiv|irsaliye|devlet)/i,
  /pci|iso\s?\d+/i,
];

const DOCUMENT_DEPTH_TRIGGERS = [
  /ba analiz|i[şs] analizi|is analizi|business analysis/i,
  /kavramsal tasar[ıi]m|kavramsal tasarim|conceptual design/i,
  /brd|fdd|gereksinim|requirement/i,
  /dok[üu]man|dokuman|rapor|taslak|word/i,
  /entegrasyon/i,
];

const FORCE_DRAFT_TRIGGERS = [
  /varsay[ıi]mlarla ilerle|varsayimlarla ilerle/i,
  /daha fazla soru sorma/i,
  /bu bilgilerle/i,
  /mevcut bilgilerle/i,
  /soru sorma/i,
  /h[ıi]zl[ıi] taslak|hizli taslak|ilk tasla[ğg]?[ıi]? ([çc][ıi]kar|olustur|haz[ıi]rla|uret|yaz)/i,
  /sen yap|ben mi yap[ıi]cam|ben mi yapacagim|devam et|durma|uygula/i,
];

export function isSapCrmAiSalesBotRequest(userMessage = ''): boolean {
  return hasDomainProfile(userMessage, 'sap_crm_ai_sales_bot');
}

export function buildSourceVerificationPolicy(userMessage = ''): SourceVerificationPolicy {
  const text = userMessage.trim();
  const isRegulatoryOrApi = sourceSensitiveForSource(text)
    || /mevzuat|yonetmelik|kanun|uyum|api|entegrasyon|oauth/i.test(text);
  const preferredSources = preferredSourcesForSource(text, [
    'Resmi kurum veya urun dokumantasyonu',
    'Mevzuat/kamu kaynaklari',
    'Uretici API dokumantasyonu',
    'Guvenilir sektor referanslari',
  ]);

  return {
    requiresSourceSeparation: isRegulatoryOrApi,
    preferredSources,
    statusLabels: ['DOGRULANDI', 'VARSAYIM', 'ACIK KONU'],
    reviewMatrixColumns: ['Konu', 'Durum', 'Kaynak / Kanit', 'Dokumandaki Kullanim', 'Not'],
  };
}

export function shouldUseDeepBaAssistant(userMessage = ''): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  const hasResearchTopic = TOPIC_RESEARCH_TRIGGERS.some((pattern) => pattern.test(text));
  const hasDocumentSignal = DOCUMENT_DEPTH_TRIGGERS.some((pattern) => pattern.test(text));
  const hasForceDraftSignal = FORCE_DRAFT_TRIGGERS.some((pattern) => pattern.test(text));

  if (requiresExternalResearchForSource(text)) return true;
  if (hasResearchTopic && (hasDocumentSignal || hasForceDraftSignal)) return true;
  if (/entegrasyon/i.test(text) && /(mevzuat|uyum|kanun|api|sap|crm|iys)/i.test(text)) return true;
  return false;
}

export function requiresExternalKnowledge(userMessage = ''): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  return shouldUseDeepBaAssistant(text)
    || TOPIC_RESEARCH_TRIGGERS.some((pattern) => pattern.test(text))
    || /g[üu]ncel|guncel|resmi kaynak|best practice|referans|kaynak/i.test(text);
}

export function buildDeepBaResearchPlan(userMessage = ''): DeepBaResearchPlan {
  const enabled = requiresExternalKnowledge(userMessage);
  const genericQueries = [
    `${userMessage} resmi kaynak mevzuat API`,
    `${userMessage} best practice entegrasyon kavramsal tasarim`,
  ];
  return {
    enabled,
    reason: enabled
      ? 'Regulasyon, API veya kurumsal entegrasyon bilgisi icerdigi icin kaynakli derin BA modu gerekli.'
      : 'Genel BA taslagi icin kurumsal hafiza yeterli olabilir.',
    searchQueries: researchQueriesForSource(userMessage, genericQueries).slice(0, 4),
    assumptions: [
      'Eksik is bilgileri [VARSAYIM] etiketiyle ayrilacak.',
      'Kaynakla dogrulanamayan mevzuat veya API detayi kesin hukum gibi yazilmayacak.',
      'Review bolumunde mevzuat/API iddialari DOGRULANDI / VARSAYIM / ACIK KONU olarak ayrilacak.',
      'Teknik, test ve akis detaylari ayri gizli sekmelere degil BA Analiz ve Review icine gomulecek.',
    ],
    documentGapsToCheck: [
      'Talep, artifact modu ve secili profil uyumu',
      'Kaynak sinyallerinin ciktiya sadakati',
      'Yuksek etkili bilgi bosluklari ve varsayilabilirlik',
      'DOGRULANDI / VARSAYIM / ACIK KONU kanit ayrimi',
    ],
  };
}

export function buildDeepBaActInstructions(userMessage = ''): string {
  const sourcePolicy = buildSourceVerificationPolicy(userMessage);
  const domainAddendum = actInstructionsForSource(userMessage).join('\n');
  return `
[DEEP BA ANALIZ DAVRANISI]
Bu katman analiz derinligini ve kanit disiplinini tanimlar; dokuman turunu veya bolumlerini secmez.

${BA_MINDSET_SYSTEM_INSTRUCTION}

Dokuman yapisi kurallari:
- AiTurnDecision icindeki artifact profile tek yapisal otoritedir.
- Profilin zorunlu basliklarini ve sirasini koru; farkli bir genel BA omurgasi uygulama.
- Profilde olmayan teknik analiz, test, API, ekran, entegrasyon veya surec bolumlerini otomatik ekleme.
- Bir detay talep, kaynak veya profil icin gerekliyse ilgili profile uygun yerde karar verilebilir derinlikte isle.
- Kaynakta olmayan rol, sistem, surec, KPI, esik, ekran veya teknik urun adi uydurma.
- Review yeni is gercegi uretmez; kanit durumu, risk, varsayim, celiski ve acik kararlari raporlar.

Davranis kurallari:
- Chat mesaji 2-5 cumlelik calisma ozeti olsun; detaylari sag panel dokumanina yaz.
- Kullanici sadece "dokuman hazirla / FDD hazirla / kavramsal tasarim yaz" dediyse bunu hedef cikti niyeti say; kritik baglam eksikse kesif asamasinda soru sorulabilir.
- Kullanici "varsayimlarla ilerle", "bu bilgilerle devam", "soru sorma", "hizli taslak", "ilk taslagi cikar", "sen yap", "devam et" dediyse yeni soru sorma.
- Kaynak arastirmasi yapildiysa hangi alanlarin kaynakla desteklendigini chat mesajinda kisa belirt.
- Kaynak bulunamazsa mevzuat/API maddelerini kesin hukum gibi yazma; [DOGRULAMA GEREKIR] etiketi kullan.
- Ornek, varsayim ve acik sorulari birbirine karistirma.
- Review'da durum etiketi sadece su uc degerden biri olsun: ${sourcePolicy.statusLabels.join(' / ')}.
- Resmi kaynak veya guvenilir referans kullanildiysa "Kaynak / Kanit" alanina kaynak adini ya da URL basligini yaz; kaynak yoksa "Kaynak bulunamadi" yaz ve Durum'u ACIK KONU yap.
- Tercih edilen kaynak turleri: ${sourcePolicy.preferredSources.join('; ')}.
${domainAddendum}
`.trim();
}

export function buildDeepBaThinkingSummary(plan: DeepBaResearchPlan): string {
  return [
    'Deep BA Assistant v2 calisma ozeti:',
    `- Mod: ${plan.enabled ? 'kaynakli derin analiz' : 'derin BA taslagi'}`,
    `- Neden: ${plan.reason}`,
    `- Kontrol boyutlari: ${plan.documentGapsToCheck.slice(0, 5).join(', ')}`,
  ].join('\n');
}

const DEFAULT_QUESTION_OPTIONS = [
  'Varsayimla ilerle',
  'Acik konu olarak birak',
  'Bu karari ben netlestirecegim',
];

function extractQuestionOptions(text: string): string[] {
  const optionMatch = text.match(/(?:^|\n)\s*Se(?:\u00e7|\u00c3\u00a7|c)enekler\s*:\s*([^\n]+)/i);
  if (!optionMatch?.[1]) return [];
  return optionMatch[1]
    .split('|')
    .map((option) => option.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function cleanClassifierQuestionText(text: string): string {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(Neden|Dokumana etkisi|Dok\u00fcmana etkisi|Secenekler|Se\u00e7enekler)\s*:/i.test(line));
  return (lines[0] || text || '').trim();
}

export function parseClassifierQuestion(text: string, index: number): Question {
  const questionText = cleanClassifierQuestionText(text);
  const options = extractQuestionOptions(text);

  return {
    id: `q${index + 1}`,
    text: questionText,
    options: options.length ? options : DEFAULT_QUESTION_OPTIONS,
  };
}
