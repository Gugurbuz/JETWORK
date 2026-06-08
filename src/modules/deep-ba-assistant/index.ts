import type { Question } from '../../types';

export interface DeepBaResearchPlan {
  enabled: boolean;
  reason: string;
  searchQueries: string[];
  assumptions: string[];
  documentGapsToCheck: string[];
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
  /dok[üu]man[ıi] olu[şs]tur|dokumani olustur/i,
  /haz[ıi]rla|hazirla|devam et|olu[şs]tur|olustur/i,
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function shouldUseDeepBaAssistant(userMessage = ''): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  const hasResearchTopic = TOPIC_RESEARCH_TRIGGERS.some((pattern) => pattern.test(text));
  const hasDocumentSignal = DOCUMENT_DEPTH_TRIGGERS.some((pattern) => pattern.test(text));
  const hasForceDraftSignal = FORCE_DRAFT_TRIGGERS.some((pattern) => pattern.test(text));

  if (hasResearchTopic && (hasDocumentSignal || hasForceDraftSignal)) return true;
  if (/sap\s+crm/i.test(text) && /iys|i[\. ]?y[\. ]?s/i.test(text)) return true;
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
  const isIysSap = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oö]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  const enabled = requiresExternalKnowledge(userMessage);
  const genericQueries = [
    `${userMessage} resmi kaynak mevzuat API`,
    `${userMessage} best practice entegrasyon kavramsal tasarim`,
  ];

  const iysQueries = [
    'IYS onay ret bildirimi 3 is gunu resmi kaynak',
    'IYS API dokumantasyonu MESAJ EPOSTA ARAMA recipient recipientType source',
    'SAP CRM IYS entegrasyonu izin yonetimi best practice',
  ];

  return {
    enabled,
    reason: enabled
      ? 'Regulasyon, API veya kurumsal entegrasyon bilgisi icerdigi icin kaynakli derin BA modu gerekli.'
      : 'Genel BA taslagi icin kurumsal hafiza yeterli olabilir.',
    searchQueries: unique(isIysSap ? iysQueries : genericQueries).slice(0, 4),
    assumptions: [
      'Eksik is bilgileri [VARSAYIM] etiketiyle ayrilacak.',
      'Kaynakla dogrulanamayan mevzuat veya API detayi kesin hukum gibi yazilmayacak.',
      'Teknik, test ve akis detaylari ayri gizli sekmelere degil BA Analiz ve Review icine gomulecek.',
    ],
    documentGapsToCheck: [
      'Konu ve is problemi',
      'Resmi/mevzuatsal baglam ve kaynak ozeti',
      'As-Is / To-Be surec anlatimi',
      'Kanal, marka, alici tipi ve veri eslestirme kurallari',
      'BR/FR/NFR/INT/RPT/SEC kodlu gereksinimler',
      'Hata, retry, audit, mutabakat ve operasyonel izleme',
      'Ekran, validasyon, bildirim ve raporlama ihtiyaclari',
      'UAT ve kabul kriterleri',
      'Riskler, varsayimlar ve acik sorular',
    ],
  };
}

export function buildDeepBaActInstructions(userMessage = ''): string {
  const isSapIys = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oö]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  const sapIysAddendum = isSapIys
    ? `
- SAP CRM <-> IYS baglaminda su alanlari ozellikle isle: 6563 uyum amaci, onay/ret yonetimi, ret sonrasi ticari ileti durdurma, 3 is gunu aktarim kuralini kaynak varsa dogrulanmis olarak; kaynak yoksa [DOGRULAMA GEREKIR] notuyla.
- Kanal bazli izin modelini kavramsal seviyede yaz: MESAJ/SMS, EPOSTA, ARAMA; recipient, recipientType, source, consentDate/status, marka kodu ve alici tipi.
- Surecleri ayir: CRM'den IYS'ye izin aktarimi, IYS'den CRM'e delta/mutabakat, initial load, hata/retry/kuyruk, veri temizligi ve operasyonel raporlama.
`.trim()
    : '';

  return `
[DEEP BA ASSISTANT V2]
Bu turda asistanin ana hedefi sohbet derinligini ve dokuman kalitesini artirmaktir.

Gorunur cikti yuzeyi:
- document.businessAnalysis: karar verilebilir BA / kavramsal tasarim dokumani.
- document.review: kalite kontrol, riskler, acik sorular, kaynak guvenilirligi ve sonraki adimlar.
- code, test ve bpmn alanlarini zorunlu uretme. Teknik analiz, test paketi ve akislar BA Analiz icinde alt baslik olarak yazilir.

businessAnalysis.content su omurgayi mumkun oldugunca doldurur:
1. Calisma ozeti ve hedef karar
2. Proje kimlik karti
3. Problem / ihtiyac ve is degeri
4. Kaynak / mevzuat / standart baglami
5. Kapsam ve kapsam disi
6. Paydaslar, roller ve sorumluluklar
7. As-Is / To-Be surec anlatimi
8. Uc uca is surecleri, tetikleyiciler, karar noktalari ve istisnalar
9. BR/FR/NFR/INT/RPT/SEC kodlu gereksinimler
10. Kavramsal veri modeli ve veri eslestirme tablolari
11. Kavramsal entegrasyon mimarisi
12. Ekran, form, validasyon, toast/modal/bildirim ve rapor ihtiyaclari
13. Hata yonetimi, retry, audit, loglama, mutabakat ve operasyonel izleme
14. UAT, kabul kriterleri ve kalite kapilari
15. Varsayimlar ve acik konular

review.content su omurgayi doldurur:
- Kaynak/dogrulama ozeti
- Risk listesi ve etki/olasilik notlari
- Netlestirilmesi gereken kararlar
- Kalite kapisi notu
- Sonraki aksiyonlar ve sprint onerisi

Davranis kurallari:
- Chat mesaji 2-5 cumlelik calisma ozeti olsun; detaylari sag panel dokumanina yaz.
- Kullanici "varsayimlarla ilerle", "devam et", "soru sorma", "hazirla" dediyse yeni soru sorma.
- Kaynak arastirmasi yapildiysa hangi alanlarin kaynakla desteklendigini chat mesajinda kisa belirt.
- Kaynak bulunamazsa mevzuat/API maddelerini kesin hukum gibi yazma; [DOGRULAMA GEREKIR] etiketi kullan.
- Ornek, varsayim ve acik sorulari birbirine karistirma.
${sapIysAddendum}
`.trim();
}

export function buildDeepBaThinkingSummary(plan: DeepBaResearchPlan): string {
  return [
    'Deep BA Assistant v2 calisma ozeti:',
    `- Mod: ${plan.enabled ? 'kaynakli derin analiz' : 'derin BA taslagi'}`,
    `- Neden: ${plan.reason}`,
    `- Kontrol basliklari: ${plan.documentGapsToCheck.slice(0, 5).join(', ')}`,
  ].join('\n');
}

export function parseClassifierQuestion(text: string, index: number): Question {
  const [questionText, optionText] = text.split(/\n\s*Se[çc]enekler\s*:\s*/i);
  const options = optionText
    ? optionText.split('|').map((option) => option.trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    id: `q${index + 1}`,
    text: questionText.trim(),
    options,
  };
}
