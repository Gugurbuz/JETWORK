import type { BehaviorDomain } from './behaviorDecision';
import { getPrimaryDomainProfile, type DomainProfileId } from '../domainProfiles';

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

const AI_ASSISTANT_PRODUCT: BaDiscoveryProfile = {
  domain: 'ai_assistant_product',
  label: 'AI asistan urunu',
  opening: 'AI asistan urunlerinde asil karar; aklin hangi kaynaklarla beslenecegi, hangi araclari kullanacagi, ne zaman soru soracagi ve kendi ciktisini nasil denetleyecegidir.',
  criticalInfo: [
    'Asistan rolu ve basari tanimi',
    'Kaynak/hafiza ve kanit politikasi',
    'Arac/aksiyon yetkileri',
    'Kalite guardrail ve insan devri',
  ],
  questions: [
    {
      id: 'assistant-role-depth',
      text: 'AI asistan hangi rolde ve hangi derinlikte calismali?',
      rationale: 'Danisman, BA, teknik copilot veya operasyon asistani rolu soru sorma, dokuman uretme ve aksiyon alma davranisini degistirir.',
      documentImpact: 'Mindset, davranis motoru, intent/gap modeli ve kalite kriterleri.',
      options: ['BA + urun copilot', 'Operasyon asistani', 'Varsayimla derin BA copilot'],
    },
    {
      id: 'assistant-evidence-memory',
      text: 'Asistan hangi kaynak, hafiza ve kanit kurallariyla karar vermeli?',
      rationale: 'Kaynakli bilgi ile varsayimi ayirmayan asistan guzel ama guvenilmez cikti uretir.',
      documentImpact: 'Evidence ledger, kaynak guard, proje hafizasi, review ve acik konu matrisi.',
      options: ['Kaynak zorunlu + varsayim ayrimi', 'Proje hafizasi oncelikli', 'Varsayimla evidence ledger'],
    },
    {
      id: 'assistant-tool-authority',
      text: 'Asistan hangi araclari kullanabilir ve hangi aksiyonlar insan onayi ister?',
      rationale: 'Kodlama, dokuman, arastirma, test ve deploy yetkileri guvenlik, audit ve eylem planini belirler.',
      documentImpact: 'Tool execution plan, yetki modeli, audit log ve insan onayi kurallari.',
      options: ['Kod/test/dokuman kullanabilir', 'Sadece analiz ve dokuman', 'Varsayimla riskli aksiyonlar onayli'],
    },
    {
      id: 'assistant-quality-loop',
      text: 'Cikti kalitesi nasil olculup otomatik onarilmali?',
      rationale: 'Self-review, coverage, kaynak uyumu ve regression testleri yoksa asistan tek duze taslak uretmeye doner.',
      documentImpact: 'Quality gate, source fidelity guard, validation loop ve eval senaryolari.',
      options: ['Guard + repair + eval', 'Sadece kalite puani', 'Varsayimla tam validation loop'],
    },
  ],
  answerMappingInstruction: [
    'Cevaplari AI asistan urunu dokumanina su sekilde isle:',
    '- Rol/derinlik cevabini mindset, agent sorumluluklari ve davranis motoruna bagla.',
    '- Kaynak/hafiza cevabini evidence ledger, kaynak guard, proje hafizasi ve varsayim politikasina cevir.',
    '- Tool cevabini arac yetkileri, insan onayi, audit ve guvenlik gereksinimleri olarak yaz.',
    '- Kalite cevabini eval, coverage, source fidelity, self-review repair ve regresyon testlerine bagla.',
  ].join('\n'),
};

const FIELD_MOBILE_APP: BaDiscoveryProfile = {
  domain: 'field_mobile_app',
  label: 'Saha/mobil uygulama',
  opening: 'Saha/mobil uygulama projelerinde offline davranis, saha aksiyonlari, senkronizasyon ve cihaz deneyimi ana tasarim kararlaridir.',
  criticalInfo: [
    'Saha kullanici yolculugu',
    'Offline-first ve senkronizasyon modeli',
    'Mobil ekran/cihaz gereksinimleri',
    'Merkez sistem entegrasyonlari',
  ],
  questions: [
    {
      id: 'field-mobile-journey',
      text: 'Saha kullanicisi gunluk akista hangi ana aksiyonlari yapacak?',
      rationale: 'Ziyaret, lead, teklif, sozlesme, tahsilat veya belge toplama kapsami ekran ve veri modelini belirler.',
      documentImpact: 'Surec modelleri, rol/aksiyon matrisi, UI ve kabul kriterleri.',
      options: ['Ziyaret + lead + teklif', 'Satis + sozlesme + belge', 'Varsayimla uctan uca saha satis'],
    },
    {
      id: 'field-mobile-offline',
      text: 'Uygulama offline-first mi calismali, yoksa online bagimli mi?',
      rationale: 'Offline karari local cache, conflict resolution, delta sync, hata ve UAT senaryolarini kokten degistirir.',
      documentImpact: 'NFR, veri senkronizasyonu, hata/retry, test ve operasyon bolumleri.',
      options: ['Offline-first + delta sync', 'Online agirlikli', 'Varsayimla offline-first'],
    },
    {
      id: 'field-mobile-device-ui',
      text: 'Mobilde hangi cihaz/ekran davranislari kritik?',
      rationale: 'Telefon/tablet, kamera, konum, imza, zorunlu alan ve hizli veri girisi kullanilabilirligi belirler.',
      documentImpact: 'UI/UX, validasyon, toast/uyari, izinler ve cihaz yetkileri.',
      options: ['Telefon + kamera + konum', 'Tablet saha ekrani', 'Varsayimla mobil cihaz yetenekleri kapsamda'],
    },
    {
      id: 'field-mobile-integration',
      text: 'Saha uygulamasi hangi merkez sistemlerle senkronize olacak?',
      rationale: 'CRM/ERP/odeme/dokuman entegrasyonlari veri sahipligi, hata modeli ve operasyon sorumlulugunu belirler.',
      documentImpact: 'Entegrasyon mimarisi, veri mapping, audit log ve mutabakat senaryolari.',
      options: ['CRM + ERP', 'CRM + dokuman + odeme', 'Acik konu olarak isaretle'],
    },
  ],
  answerMappingInstruction: 'Saha/mobil cevaplarini kullanici yolculugu, offline sync, mobil UI, cihaz izinleri, entegrasyon, UAT ve degisim yonetimi bolumlerine isle.',
};

const OPERATIONS_PLATFORM: BaDiscoveryProfile = {
  domain: 'operations_platform',
  label: 'Operasyon platformu',
  opening: 'Operasyon platformlarinda vaka/talep yasam dongusu, SLA, onay, mutabakat ve is listesi davranisi ana tasarim omurgasidir.',
  criticalInfo: [
    'Talep/case yasam dongusu',
    'Onay ve SLA kurallari',
    'ERP/finans/odeme entegrasyonu',
    'Operasyon raporlama ve eskalasyon',
  ],
  questions: [
    {
      id: 'ops-lifecycle',
      text: 'Talep veya case hangi durum akislariyla acilip kapanacak?',
      rationale: 'Durum modeli net olmazsa ekran, yetki, SLA, rapor ve entegrasyon tasarimi dagilir.',
      documentImpact: 'Surec modeli, status transition, is kurallari ve kabul kriterleri.',
      options: ['Acik > inceleme > onay > kapandi', 'Case tipi bazli akis', 'Varsayimla standart operasyon yasam dongusu'],
    },
    {
      id: 'ops-approval-sla',
      text: 'Onay, SLA ve eskalasyon kurallari nasil calismali?',
      rationale: 'Onay esikleri ve gecikme kurallari gorev dagilimi, bildirim ve KPI tasarimini belirler.',
      documentImpact: 'BR/NFR/KPI, bildirim, dashboard ve operasyon is listesi.',
      options: ['Rol bazli onay + SLA', 'Tutar/esik bazli onay', 'Varsayimla SLA + eskalasyon'],
    },
    {
      id: 'ops-integrations',
      text: 'Operasyon platformu hangi sistemlerle veri alisverisi yapacak?',
      rationale: 'ERP, odeme, portal veya bildirim entegrasyonlari veri sahipligi ve hata/retry modelini belirler.',
      documentImpact: 'INT gereksinimleri, veri mapping, hata yonetimi ve mutabakat.',
      options: ['ERP + odeme', 'Portal + ERP + bildirim', 'Acik konu olarak isaretle'],
    },
    {
      id: 'ops-reporting',
      text: 'Operasyon basarisi hangi dashboard ve KPI ile izlenecek?',
      rationale: 'KPI olmadan platformun is degeri ve kabul kriterleri karar verilebilir olmaz.',
      documentImpact: 'Raporlama, KPI, kalite kapisi ve UAT.',
      options: ['SLA + hata + hacim', 'Finansal mutabakat + sure', 'Varsayimla operasyon KPI seti'],
    },
  ],
  answerMappingInstruction: 'Operasyon platformu cevaplarini case yasam dongusu, SLA/onay, sistem entegrasyonlari, is listesi, dashboard, KPI ve UAT bolumlerine isle.',
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
  ai_assistant_product: AI_ASSISTANT_PRODUCT,
  field_mobile_app: FIELD_MOBILE_APP,
  operations_platform: OPERATIONS_PLATFORM,
  digital_contract: DIGITAL_CONTRACT,
  integration_project: INTEGRATION_PROJECT,
  crm_process: GENERIC_BA,
  document_management: GENERIC_BA,
  generic_ba: GENERIC_BA,
};

const DOMAIN_PROFILE_TO_DISCOVERY: Partial<Record<DomainProfileId, BehaviorDomain>> = {
  sap_crm_iys: 'sap_crm_iys',
  sap_crm_ai_sales_bot: 'sap_crm_ai_sales_bot',
  field_mobile_app: 'field_mobile_app',
  operations_platform: 'operations_platform',
  digital_contract: 'digital_contract',
  integration_project: 'integration_project',
};

export function detectBaDiscoveryDomain(message: string): BehaviorDomain | null {
  const profileDomain = getPrimaryDomainProfile(message)?.id;
  if (profileDomain && DOMAIN_PROFILE_TO_DISCOVERY[profileDomain]) {
    return DOMAIN_PROFILE_TO_DISCOVERY[profileDomain]!;
  }

  const text = normalizeDomainText(message);
  if (/sap\s*crm/.test(text) && /(iys|ileti yonetim sistemi)/.test(text)) return 'sap_crm_iys';
  if (/sap\s*crm/.test(text) && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis botu|sales bot|lead|opportunity|firsat)/.test(text)) {
    return 'sap_crm_ai_sales_bot';
  }
  if (/(yapay zeka|ai|copilot|chatbot|asistan|assistant|sohbet)/.test(text)
    && /(urun|product|motor|akil|davranis|mindset|tool|arac|hafiza|memory|agent|orchestrator|derinlik|derinlig|yetenek)/.test(text)) {
    return 'ai_assistant_product';
  }
  if (/(saha|d2d|door to door|door-to-door|mobil|mobile|tablet|offline)/.test(text)
    && /(satis|sales|uygulama|app|refactor|donusum|donusumu|crm|musteri)/.test(text)) {
    return 'field_mobile_app';
  }
  if (/(operasyon|iade|iptal|talep|case|ticket|is listesi|workflow|onay|sla)/.test(text)
    && /(platform|uygulama|sistem|portal|surec|proje|erp|odeme|finans)/.test(text)) {
    return 'operations_platform';
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
