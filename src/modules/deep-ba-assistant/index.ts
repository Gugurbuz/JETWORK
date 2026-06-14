import type { Question } from '../../types';

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
  /\biys\b|i[\. ]?y[\. ]?s|ileti y[oÃ¶]netim sistemi|ileti yonetim sistemi/i,
  /kvkk|gdpr|mevzuat|y[oÃ¶]netmelik|kanun|uyum/i,
  /api|entegrasyon|integration|middleware|oauth|sso/i,
  /e[- ]?(fatura|ar[ÅŸs]iv|arsiv|irsaliye|devlet)/i,
  /pci|iso\s?\d+/i,
];

const DOCUMENT_DEPTH_TRIGGERS = [
  /ba analiz|i[ÅŸs] analizi|is analizi|business analysis/i,
  /kavramsal tasar[Ä±i]m|kavramsal tasarim|conceptual design/i,
  /brd|fdd|gereksinim|requirement/i,
  /dok[Ã¼u]man|dokuman|rapor|taslak|word/i,
  /entegrasyon/i,
];

const FORCE_DRAFT_TRIGGERS = [
  /varsay[Ä±i]mlarla ilerle|varsayimlarla ilerle/i,
  /daha fazla soru sorma/i,
  /bu bilgilerle/i,
  /dok[Ã¼u]man[Ä±i] olu[ÅŸs]tur|dokumani olustur/i,
  /haz[Ä±i]rla|hazirla|devam et|olu[ÅŸs]tur|olustur/i,
];

function normalizeDomainText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c');
}

export function isSapCrmAiSalesBotRequest(userMessage = ''): boolean {
  const text = normalizeDomainText(userMessage);
  return /sap\s*crm/.test(text)
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|lead|opportunity|firsat|musteri)/.test(text);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function buildSourceVerificationPolicy(userMessage = ''): SourceVerificationPolicy {
  const text = userMessage.trim();
  const isIys = /iys|i[\. ]?y[\. ]?s|ileti y/i.test(text);
  const isCrmAiSalesBot = isSapCrmAiSalesBotRequest(text);
  const isRegulatoryOrApi = isIys || isCrmAiSalesBot || /mevzuat|yonetmelik|kanun|uyum|api|entegrasyon|oauth/i.test(text);
  const preferredSources = isIys
    ? [
        'IYS resmi web sitesi ve SSS sayfalari',
        'IYS AHS API dokumantasyonu (ahsdocs.iys.org.tr)',
        'IYS API lisans kosullari',
        'mevzuat.gov.tr uzerindeki 6563 sayili Kanun ve ilgili yonetmelik',
        'Ticaret Bakanligi IYS sayfalari',
        'TOBB veya yetkilendirilmis kurumsal duyurular',
      ]
    : isCrmAiSalesBot
      ? [
          'SAP Help Portal CRM / Sales dokumantasyonu',
          'SAP Business AI ve Joule resmi SAP dokumantasyonu',
          'SAP Sales Cloud / CRM lead, opportunity, activity referanslari',
          'KVKK ve kurumsal veri guvenligi politikalari',
          'Guvenilir AI governance ve insan onayi referanslari',
        ]
    : [
        'Resmi kurum veya urun dokumantasyonu',
        'Mevzuat/kamu kaynaklari',
        'Uretici API dokumantasyonu',
        'Guvenilir sektor referanslari',
      ];

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

  if (isSapCrmAiSalesBotRequest(text)) return true;
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
    || /g[Ã¼u]ncel|guncel|resmi kaynak|best practice|referans|kaynak/i.test(text);
}

export function buildDeepBaResearchPlan(userMessage = ''): DeepBaResearchPlan {
  const isIysSap = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oÃ¶]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  const isCrmAiSalesBot = isSapCrmAiSalesBotRequest(userMessage);
  const enabled = requiresExternalKnowledge(userMessage);
  const genericQueries = [
    `${userMessage} resmi kaynak mevzuat API`,
    `${userMessage} best practice entegrasyon kavramsal tasarim`,
  ];

  const iysQueries = [
    'site:iys.org.tr/iys/sss IYS ret bildirimi 3 is gunu',
    'site:mevzuat.gov.tr 6563 ticari elektronik ileti onay ret IYS',
    'site:ahsdocs.iys.org.tr recipientType type ARAMA MESAJ E164 IYS',
    'site:ticaret.gov.tr Ileti Yonetim Sistemi IYS TOBB 6563',
  ];

  const crmAiSalesBotQueries = [
    'site:help.sap.com SAP CRM sales lead opportunity activity management',
    'site:help.sap.com SAP CRM interaction center sales lead opportunity',
    'site:sap.com SAP Business AI sales CRM assistant Joule',
    `${userMessage} CRM AI sales assistant best practice lead qualification human handoff governance`,
  ];

  return {
    enabled,
    reason: enabled
      ? 'Regulasyon, API veya kurumsal entegrasyon bilgisi icerdigi icin kaynakli derin BA modu gerekli.'
      : 'Genel BA taslagi icin kurumsal hafiza yeterli olabilir.',
    searchQueries: unique(isIysSap ? iysQueries : isCrmAiSalesBot ? crmAiSalesBotQueries : genericQueries).slice(0, 4),
    assumptions: [
      'Eksik is bilgileri [VARSAYIM] etiketiyle ayrilacak.',
      'Kaynakla dogrulanamayan mevzuat veya API detayi kesin hukum gibi yazilmayacak.',
      'Review bolumunde mevzuat/API iddialari DOGRULANDI / VARSAYIM / ACIK KONU olarak ayrilacak.',
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
      'Kaynak ve dogrulama matrisi',
    ],
  };
}

export function buildDeepBaActInstructions(userMessage = ''): string {
  const sourcePolicy = buildSourceVerificationPolicy(userMessage);
  const isCrmAiSalesBot = isSapCrmAiSalesBotRequest(userMessage);
  const isSapIys = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oÃ¶]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  const sapIysAddendum = isSapIys
    ? `
- SAP CRM <-> IYS baglaminda su alanlari ozellikle isle: 6563 uyum amaci, onay/ret yonetimi, ret sonrasi ticari ileti durdurma, 3 is gunu aktarim kuralini kaynak varsa dogrulanmis olarak; kaynak yoksa [DOGRULAMA GEREKIR] notuyla.
- Kanal bazli izin modelini kavramsal seviyede yaz: MESAJ/SMS, EPOSTA, ARAMA; recipient, recipientType, source, consentDate/status, marka kodu ve alici tipi.
- Surecleri ayir: CRM'den IYS'ye izin aktarimi, IYS'den CRM'e delta/mutabakat, initial load, hata/retry/kuyruk, veri temizligi ve operasyonel raporlama.
- Resmi kaynak bulunmadan 3 is gunu, API alanlari, kanal degerleri, rate limit veya yasal sure gibi maddeleri DOGRULANDI diye isaretleme.
`.trim()
    : '';
  const crmAiSalesBotAddendum = isCrmAiSalesBot
    ? `
- SAP CRM AI satis botu baglaminda su alanlari ozellikle isle: satis kanallari, lead yakalama, lead nitelendirme, opportunity olusturma, activity/task kaydi, temsilciye devir ve musteri etkilesim gecmisi.
- Surecleri ayir: bot karsilama ve niyet anlama, lead/opportunity nitelendirme, teklif/urun oneri akisi, SAP CRM kaydi ve satis temsilcisi handoff, model izleme ve kalite kontrol.
- Kavramsal veri modelinde Business Partner, Contact, Lead, Opportunity, Activity, Campaign, Conversation, Consent, Handoff ve Audit Log varliklarini degerlendir.
- AI davranis kurallarini yaz: guven skoru, insan onayi, hallucination guard, KVKK/veri maskeleme, loglama, prompt/yanit denetimi ve model performans izleme.
- KPI'lari somutlastir: lead donusum orani, ilk yanit suresi, nitelikli lead orani, temsilciye devir basari orani, CRM veri tamligi, CSAT ve satis kapanis etkisi.
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
- Kaynak ve Dogrulama Matrisi: | Konu | Durum | Kaynak / Kanit | Dokumandaki Kullanim | Not |
- Dogrulandi: kaynakla desteklenen mevzuat/API/standart maddeleri
- Varsayimlar: is veya teknik karara dayali ama henuz teyit edilmemis maddeler
- Acik Konular: kullanici, kurum, tedarikci veya resmi dokumanla netlesmesi gereken maddeler
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
- Review'da durum etiketi sadece su uc degerden biri olsun: ${sourcePolicy.statusLabels.join(' / ')}.
- Resmi kaynak veya guvenilir referans kullanildiysa "Kaynak / Kanit" alanina kaynak adini ya da URL basligini yaz; kaynak yoksa "Kaynak bulunamadi" yaz ve Durum'u ACIK KONU yap.
- Tercih edilen kaynak turleri: ${sourcePolicy.preferredSources.join('; ')}.
${sapIysAddendum}
${crmAiSalesBotAddendum}
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
  const [questionText, optionText] = text.split(/\n\s*Se[Ã§c]enekler\s*:\s*/i);
  const options = optionText
    ? optionText.split('|').map((option) => option.trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    id: `q${index + 1}`,
    text: questionText.trim(),
    options,
  };
}
