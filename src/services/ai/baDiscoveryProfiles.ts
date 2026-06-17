import type { BehaviorDomain } from './behaviorDecision';

export interface BaDiscoveryQuestionSpec {
  id: string;
  text: string;
  rationale: string;
  documentImpact: string;
  options: string[];
}

export interface BaDiscoveryProfile {
  domain: BehaviorDomain;
  label: string;
  opening: string;
  criticalInfo: string[];
  questions: BaDiscoveryQuestionSpec[];
  answerMappingInstruction: string;
}

function normalizeDomainText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatQuestion(spec: BaDiscoveryQuestionSpec): string {
  return [
    spec.text,
    `Neden: ${spec.rationale}`,
    `Dokumana etkisi: ${spec.documentImpact}`,
    `Secenekler: ${spec.options.join(' | ')}`,
  ].join('\n');
}

const SAP_CRM_AI_SALES_BOT: BaDiscoveryProfile = {
  domain: 'sap_crm_ai_sales_bot',
  label: 'SAP CRM AI satis botu',
  opening: 'SAP CRM AI satis botu icin once botun kanali, CRM aksiyon siniri ve insan onayi kararlarini netlestirmek gerekir.',
  criticalInfo: [
    'Calisma kanali',
    'SAP CRM satis nesneleri',
    'Bot aksiyon yetkisi',
    'Insana devir ve kalite kontrol kurali',
  ],
  questions: [
    {
      id: 'sales-bot-channel',
      text: 'AI satis botu hangi kanallarda calisacak?',
      rationale: 'Kanal karari kimlik dogrulama, ekran akisi, mesajlasma logu ve temsilci devri tasarimini degistirir.',
      documentImpact: 'Kapsam, kullanici yolculugu, ekran/bildirim ve entegrasyon bolumleri.',
      options: ['Web chat + WhatsApp', 'SAP CRM icinde temsilci asistani', 'Varsayimla coklu kanal'],
    },
    {
      id: 'sales-bot-crm-objects',
      text: 'SAP CRM tarafinda hangi satis nesneleri yonetilecek?',
      rationale: 'Lead, Opportunity ve Activity kapsami veri modeli, is kurallari ve kabul kriterlerini belirler.',
      documentImpact: 'FR/INT gereksinimleri, kavramsal veri modeli ve SAP CRM kayit kurallari.',
      options: ['Lead + Opportunity + Activity', 'Sadece lead olusturma', 'Varsayimla lead ve opportunity kapsamda'],
    },
    {
      id: 'sales-bot-action-authority',
      text: 'Bot hangi seviyede aksiyon alabilecek?',
      rationale: 'Oneri veren bot ile CRM kaydi acan botun risk, yetki, audit ve insan onayi ihtiyaci farklidir.',
      documentImpact: 'AI davranis kurallari, yetki modeli, audit log ve risk listesi.',
      options: ['Sadece oneri ve ozet', 'Lead nitelendirme + CRM kaydi', 'Varsayimla kritik islemler temsilci onayli'],
    },
    {
      id: 'sales-bot-handoff',
      text: 'Insana devir ve kalite kontrol hangi kuralla calisacak?',
      rationale: 'Dusuk guven, sikayet, fiyat/taahhut veya KVKK riski olan anlarda botun durup temsilciye devretmesi gerekir.',
      documentImpact: 'Surec modeli, istisna akislari, NFR/SEC ve UAT senaryolari.',
      options: ['Dusuk guvende temsilciye devir', 'Tum satis aksiyonlari onayli', 'Varsayimla risk bazli devir modeli'],
    },
  ],
  answerMappingInstruction: [
    'Cevaplari SAP CRM AI satis botu dokumanina su sekilde isle:',
    '- Kanal cevabini kapsam, kullanici yolculugu, ekran/bildirim ve loglama bolumlerine bagla.',
    '- CRM nesnesi cevabini Business Partner, Contact, Lead, Opportunity, Activity ve Conversation veri modeline cevir.',
    '- Aksiyon yetkisi cevabini BR/FR/SEC/NFR gereksinimleri, insan onayi ve audit kurallari olarak yaz.',
    '- Handoff cevabini surec modeli, istisna akislari, UAT ve risk listesine bagla.',
  ].join('\n'),
};

const SAP_CRM_IYS: BaDiscoveryProfile = {
  domain: 'sap_crm_iys',
  label: 'SAP CRM - IYS entegrasyonu',
  opening: 'SAP CRM - IYS entegrasyonu icin izin kapsami, marka yapisi, ara katman ve mutabakat kararlari dokumanin omurgasini belirler.',
  criticalInfo: [
    'Izin kanali kapsami',
    'Marka kodu yapisi',
    'Middleware tercihi',
    'Initial load ve gunluk delta kapsami',
  ],
  questions: [
    {
      id: 'iys-channel-scope',
      text: 'IYS izin kapsami hangi iletisim kanallarini icermeli?',
      rationale: 'SMS, e-posta ve arama kanallari veri modeli, API alanlari ve kabul kriterlerini farkli etkiler.',
      documentImpact: 'Kapsam, kanal bazli is kurallari, veri eslestirme ve test senaryolari.',
      options: ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayimla tum kanallar'],
    },
    {
      id: 'iys-brand-structure',
      text: 'Sirket IYS tarafinda tek marka kodu mu, coklu marka yapisi mi kullaniyor?',
      rationale: 'Marka yapisi izin sahipligi, veri ayrimi, mutabakat ve raporlama tasarimini degistirir.',
      documentImpact: 'Veri modeli, is kurallari, raporlar ve acik konular matrisi.',
      options: ['Tek marka kodu', 'Coklu marka', 'Varsayimla coklu marka desteklensin'],
    },
    {
      id: 'iys-middleware',
      text: 'SAP CRM ile IYS arasinda hangi ara katman varsayilsin?',
      rationale: 'CPI, PI/PO veya farkli middleware secimi hata, retry, guvenlik ve operasyon izleme modelini belirler.',
      documentImpact: 'Kavramsal entegrasyon mimarisi, INT/NFR gereksinimleri ve riskler.',
      options: ['SAP CPI', 'SAP PI/PO', 'Varsayimla karar acik kalsin'],
    },
    {
      id: 'iys-load-delta',
      text: 'Ilk aktarim ve gunluk mutabakat kapsami nasil ele alinsin?',
      rationale: 'Initial load ve delta kapsam karari veri temizligi, performans, batch ve kabul testlerini etkiler.',
      documentImpact: 'Surec modelleri, operasyonel izleme, performans ve UAT bolumleri.',
      options: ['Initial load + gunluk delta', 'Sadece gunluk delta', 'Varsayimla ikisi de kapsamda'],
    },
  ],
  answerMappingInstruction: [
    'Cevaplari SAP CRM - IYS dokumanina su sekilde isle:',
    '- Kanal cevabini izin tipi, alici tipi, veri eslestirme ve test senaryolarina cevir.',
    '- Marka cevabini marka kodu is kurallari, raporlama ve mutabakat tasarimina bagla.',
    '- Middleware cevabini entegrasyon mimarisi, guvenlik, retry ve loglama gereksinimi olarak yaz.',
    '- Initial load/delta cevabini surec modeli, operasyon ve performans kabul kriterlerine bagla.',
  ].join('\n'),
};

const DIGITAL_CONTRACT: BaDiscoveryProfile = {
  domain: 'digital_contract',
  label: 'Dijital sozlesme',
  opening: 'Dijital sozlesme projesinde imza yontemi, arsivleme ve onay rolleri hukuki gecerlik ile operasyon tasarimini belirler.',
  criticalInfo: ['Imza/onay yontemi', 'Arsivleme sistemi', 'Onay rolleri', 'Hukuki saklama gereksinimi'],
  questions: [
    {
      id: 'contract-signature',
      text: 'Dijital sozlesme surecinde imza/onay yontemi nasil olmali?',
      rationale: 'E-imza, mobil imza veya OTP secimi hukuki gecerlik, kimlik dogrulama ve audit tasarimini degistirir.',
      documentImpact: 'Is kurallari, SEC/NFR, kabul kriterleri ve acik konular.',
      options: ['E-imza / mobil imza', 'OTP onay', 'Varsayimla iki secenek de degerlendirilsin'],
    },
    {
      id: 'contract-archive',
      text: 'Sozlesme saklama ve arsivleme nerede yapilacak?',
      rationale: 'Arsiv sistemi kararinin veri modeli, entegrasyon, saklama suresi ve erisim yetkilerine etkisi vardir.',
      documentImpact: 'Veri modeli, entegrasyon mimarisi, rapor ve denetim ihtiyaclari.',
      options: ['FileNet / DMS', 'Uygulama ici saklama', 'Acik konu olarak kalsin'],
    },
    {
      id: 'contract-approval-roles',
      text: 'Onay akisi hangi rolleri icermeli?',
      rationale: 'Rol karari ekran, is akisi, bildirim ve RACI tablosunu belirler.',
      documentImpact: 'Paydas/RACI, surec modeli, ekran ve bildirim gereksinimleri.',
      options: ['Musteri + operasyon', 'Musteri + satis + hukuk', 'Varsayimla cok rollu akis'],
    },
  ],
  answerMappingInstruction: 'Dijital sozlesme cevaplarini imza/onay kurali, arsiv entegrasyonu, rol bazli akis, saklama ve denetim gereksinimleri olarak dokumana isle.',
};

const INTEGRATION_PROJECT: BaDiscoveryProfile = {
  domain: 'integration_project',
  label: 'Entegrasyon projesi',
  opening: 'Entegrasyon projelerinde kaynak/hedef sistem, veri sahipligi ve hata modeli netlesmeden saglam kavramsal tasarim kurulamaz.',
  criticalInfo: ['Kaynak ve hedef sistem', 'Entegrasyon tipi', 'Hata ve retry modeli', 'Veri sahipligi'],
  questions: [
    {
      id: 'integration-type',
      text: 'Entegrasyon tipi nasil ilerlemeli?',
      rationale: 'REST, batch veya hibrit secim performans, hata yonetimi ve operasyon izleme tasarimini degistirir.',
      documentImpact: 'INT/NFR gereksinimleri, surec modeli ve entegrasyon mimarisi.',
      options: ['REST API', 'Batch / dosya aktarimi', 'Varsayimla hibrit yapi'],
    },
    {
      id: 'integration-error',
      text: 'Hata yonetimi nasil tasarlansin?',
      rationale: 'Retry, kuyruk veya manuel is listesi secimi operasyonel dayaniklilik ve SLA kararidir.',
      documentImpact: 'Hata senaryolari, OPS/NFR, raporlama ve UAT.',
      options: ['Retry + kuyruk', 'Manuel operasyon is listesi', 'Ikisi de kapsamda'],
    },
    {
      id: 'integration-master-data',
      text: 'Ana veri kaynagi hangi sistem olsun?',
      rationale: 'Veri sahipligi karari guncelleme yonu, mutabakat ve cakisma cozumunu belirler.',
      documentImpact: 'Veri modeli, is kurallari, mutabakat ve acik konular.',
      options: ['Kaynak sistem', 'Hedef sistem', 'Acik konu olarak isaretle'],
    },
  ],
  answerMappingInstruction: 'Entegrasyon cevaplarini kaynak-hedef sistem, veri sahipligi, hata/retry, mutabakat ve operasyon izleme gereksinimleri olarak dokumana isle.',
};

const GENERIC_BA: BaDiscoveryProfile = {
  domain: 'generic_ba',
  label: 'Genel is analizi',
  opening: 'Genel is analizi icin once problem, basari olcutu ve ilk surum kapsami netlesmelidir.',
  criticalInfo: ['Ana is problemi', 'Basari KPI', 'Ilk surum kapsami'],
  questions: [
    {
      id: 'generic-problem',
      text: 'Ana is problemi ve kullanicinin bekledigi hedef karar nedir?',
      rationale: 'Problem net olmazsa dokuman sadece genel gecer cozum listesine doner.',
      documentImpact: 'Amac, kapsam, is degeri ve kabul kriterleri.',
      options: ['Yeni surec/dokuman tasarimi', 'Mevcut sureci iyilestirme', 'Varsayimla kavramsal tasarim'],
    },
    {
      id: 'generic-kpi',
      text: 'Basari hangi KPI veya is degeriyle olculecek?',
      rationale: 'KPI karar verilebilir gereksinim, oncelik ve kabul kriteri yazmayi saglar.',
      documentImpact: 'KPI tablosu, is gerekleri ve kalite kapisi.',
      options: ['Sure azalmasi', 'Hata/risk azalmasi', 'Izlenebilirlik ve karar kalitesi'],
    },
    {
      id: 'generic-scope',
      text: 'Ilk surumde hangi surec, rol ve sistem davranislari kesin kapsamda olmali?',
      rationale: 'MVP siniri yoksa dokuman gereksiz buyur ve uygulanabilirligini kaybeder.',
      documentImpact: 'Kapsam/kapsam disi, surec modeli ve yol haritasi.',
      options: ['MVP kapsam', 'Uctan uca kapsam', 'Varsayimla kurumsal BA kapsami'],
    },
  ],
  answerMappingInstruction: 'Genel cevaplari problem, KPI, kapsam, gereksinim, kabul kriteri, risk ve acik konu basliklarina isle.',
};

const PROFILES: Record<BehaviorDomain, BaDiscoveryProfile> = {
  sap_crm_iys: SAP_CRM_IYS,
  sap_crm_ai_sales_bot: SAP_CRM_AI_SALES_BOT,
  digital_contract: DIGITAL_CONTRACT,
  integration_project: INTEGRATION_PROJECT,
  crm_process: GENERIC_BA,
  document_management: GENERIC_BA,
  generic_ba: GENERIC_BA,
};

export function detectBaDiscoveryDomain(message: string): BehaviorDomain | null {
  const text = normalizeDomainText(message);
  if (/sap\s*crm/.test(text) && /(iys|ileti yonetim sistemi)/.test(text)) return 'sap_crm_iys';
  if (/sap\s*crm/.test(text) && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|lead|opportunity|firsat|musteri)/.test(text)) {
    return 'sap_crm_ai_sales_bot';
  }
  if (/(dijital sozlesme|e-imza|e imza|sozlesme)/.test(text)) return 'digital_contract';
  if (/(entegrasyon|integration|api|servis|middleware|sap|crm)/.test(text)) return 'integration_project';
  return null;
}

export function getBaDiscoveryProfile(domain: BehaviorDomain): BaDiscoveryProfile {
  return PROFILES[domain] || GENERIC_BA;
}

export function buildDomainDiscoveryQuestions(domain: BehaviorDomain): string[] {
  return getBaDiscoveryProfile(domain).questions.map(formatQuestion);
}

export function buildContextualDiscoveryQuestions(message: string): string[] {
  const domain = detectBaDiscoveryDomain(message);
  return domain ? buildDomainDiscoveryQuestions(domain) : [];
}

export function buildCriticalInfoForDomain(domain: BehaviorDomain): string[] {
  return getBaDiscoveryProfile(domain).criticalInfo;
}

export function buildDiscoveryRationalesForDomain(domain: BehaviorDomain): string[] {
  return getBaDiscoveryProfile(domain).questions.map((question) => question.rationale);
}

export function buildDiscoveryAnswerMappingInstruction(domain: BehaviorDomain): string {
  return getBaDiscoveryProfile(domain).answerMappingInstruction;
}
