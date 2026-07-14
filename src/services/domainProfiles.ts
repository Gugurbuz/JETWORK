export type DomainProfileId =
  | 'project_tracking_pemp'
  | 'sap_crm_iys'
  | 'sap_crm_ai_sales_bot'
  | 'field_mobile_app'
  | 'digital_contract'
  | 'integration_project'
  | 'operations_platform';

export interface DomainSignalContribution {
  roles?: string[];
  systems?: string[];
  integrations?: string[];
  documentRules?: string[];
  dashboardNeeds?: string[];
  uiNeeds?: string[];
  kpis?: string[];
  risks?: string[];
  openTopics?: string[];
}

export interface DomainProfile {
  id: DomainProfileId;
  hint: string;
  label: string;
  projectName?: string;
  processTitles?: string[];
  minProcessCount?: number;
  sourceSensitive?: boolean;
  requiresExternalResearch?: boolean;
  preferredSources?: string[];
  researchQueries?: string[];
  actInstructions?: string[];
  match: (normalizedText: string) => boolean;
  signals?: (normalizedText: string) => DomainSignalContribution;
}

export const PEMP_PROCESS_TITLES = [
  'Proje Kaydinin Olusturulmasi',
  'Teminat',
  'Satinalma',
  'Alt Yuklenici Islemleri',
  'Musteri Islemleri',
  'Kurulum',
  'GES Kabul Islemleri',
  'Faturalama Islemleri',
  'Bakim Islemleri',
  'Hukuki Durum',
];

export function normalizeDomainText(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/[Ä±Ä°]/g, 'i')
    .replace(/[ÅŸÅ]/g, 's')
    .replace(/[ÄŸÄ]/g, 'g')
    .replace(/[Ã¼Ãœ]/g, 'u')
    .replace(/[Ã¶Ã–]/g, 'o')
    .replace(/[Ã§Ã‡]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

export const DOMAIN_PROFILES: DomainProfile[] = [
  {
    id: 'project_tracking_pemp',
    hint: 'proje_takip_pemp',
    label: 'Proje takip / PEMP',
    projectName: 'Musteri Cozumleri Proje Yonetim Sistemi (PEMP-1157)',
    processTitles: PEMP_PROCESS_TITLES,
    minProcessCount: PEMP_PROCESS_TITLES.length,
    match: text => has(text, /pemp-?\d+|musteri cozumleri proje yonetim sistemi/)
      || (has(text, /ges|proje bazli dashboard/) && has(text, /teminat|satinalma|bakim|faturalama|kurulum/)),
    signals: text => ({
      roles: [
        has(text, /satis/) ? 'Satis' : '',
        has(text, /vergi/) ? 'Vergi' : '',
        has(text, /muhasebe/) ? 'Muhasebe' : '',
        has(text, /pmo|proje yonetimi/) ? 'Proje Yonetimi / PMO' : '',
        has(text, /kapsam/) ? 'Kapsam Ekibi' : '',
        has(text, /satinalma/) ? 'Satinalma' : '',
        has(text, /alt yuklenici/) ? 'Alt Yuklenici' : '',
        has(text, /hukuk|hukuki|dava|ihtilaf|ihtarname/) ? 'Hukuk' : '',
      ],
      systems: [
        has(text, /sap/) ? 'SAP' : '',
        has(text, /eba/) ? 'EBA' : '',
        has(text, /filenet/) ? 'FileNet' : '',
        has(text, /dashboard/) ? 'Dashboard' : '',
      ],
      integrations: [
        has(text, /sap/) ? 'SAP bilgi/belge ve finansal durum akisi' : '',
        has(text, /eba/) ? 'EBA onay/gorev akisi' : '',
        has(text, /mail|e-posta|eposta/) ? 'E-posta/bildirim servisi' : '',
        has(text, /filenet|dokuman|belge|evrak/) ? 'Dokuman yonetimi entegrasyonu' : '',
      ],
      documentRules: [
        has(text, /zorunlu evrak|zorunlu dokuman|belge yukleme|dokuman yukleme/) ? 'Zorunlu evrak ve belge yukleme kontrolu' : '',
        has(text, /sozlesme/) ? 'Sozlesme dokumani ve imza/onay tarihcesi' : '',
        has(text, /teminat/) ? 'Teminat mektubu ve gecerlilik tarihi kontrolu' : '',
        has(text, /kabul|tedas/) ? 'Kabul ve resmi kurum evraklari' : '',
        has(text, /bakim/) ? 'Bakim formu ve bakim tarihcesi' : '',
        has(text, /hukuk|hukuki|dava|ihtilaf|ihtarname/) ? 'Hukuki evrak, ihtarname ve dava dokumanlari' : '',
      ],
      dashboardNeeds: [
        has(text, /deadline|gecikme/) ? 'Deadline ve gecikme dashboardu' : '',
        has(text, /kapasite/) ? 'Kapasite ve proje ilerleme dashboardu' : '',
        has(text, /acik gorev|bekleyen is/) ? 'Acik gorev ve bekleyen is raporu' : '',
      ],
      kpis: [
        has(text, /deadline|gecikme/) ? 'Deadline uyum orani' : '',
        has(text, /bakim/) ? 'Planli bakim zamaninda tamamlama orani' : '',
      ],
      risks: [
        has(text, /sap/) ? 'SAP veri akisi ve belge eslesmesi netlesmezse finansal kapanis kirilabilir.' : '',
      ],
      openTopics: [
        has(text, /sap/) ? "SAP'den hangi belge ve statulerin hangi siklikla alinacagi netlestirilmeli." : '',
      ],
    }),
  },
  {
    id: 'sap_crm_iys',
    hint: 'iys',
    label: 'SAP CRM - IYS entegrasyonu',
    projectName: 'SAP CRM - IYS Entegrasyonu',
    processTitles: [
      "SAP CRM'den IYS'ye izin aktarimi",
      "IYS'den SAP CRM'e gunluk delta ve mutabakat",
      'Hata, retry, operasyon izleme ve raporlama',
    ],
    minProcessCount: 3,
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: [
      'IYS resmi web sitesi ve SSS sayfalari',
      'IYS AHS API dokumantasyonu (ahsdocs.iys.org.tr)',
      'IYS API lisans kosullari',
      'mevzuat.gov.tr uzerindeki 6563 sayili Kanun ve ilgili yonetmelik',
      'Ticaret Bakanligi IYS sayfalari',
      'TOBB veya yetkilendirilmis kurumsal duyurular',
    ],
    researchQueries: [
      'site:iys.org.tr/iys/sss IYS ret bildirimi 3 is gunu',
      'site:mevzuat.gov.tr 6563 ticari elektronik ileti onay ret IYS',
      'site:ahsdocs.iys.org.tr recipientType type ARAMA MESAJ E164 IYS',
      'site:ticaret.gov.tr Ileti Yonetim Sistemi IYS TOBB 6563',
    ],
    actInstructions: [
      "- SAP CRM <-> IYS baglaminda su alanlari ozellikle isle: 6563 uyum amaci, onay/ret yonetimi, ret sonrasi ticari ileti durdurma, 3 is gunu aktarim kuralini kaynak varsa dogrulanmis olarak; kaynak yoksa [DOGRULAMA GEREKIR] notuyla.",
      '- Kanal bazli izin modelini kavramsal seviyede yaz: MESAJ/SMS, EPOSTA, ARAMA; recipient, recipientType, source, consentDate/status, marka kodu ve alici tipi.',
      "- Surecleri ayir: CRM'den IYS'ye izin aktarimi, IYS'den CRM'e delta/mutabakat, initial load, hata/retry/kuyruk, veri temizligi ve operasyonel raporlama.",
      '- Resmi kaynak bulunmadan 3 is gunu, API alanlari, kanal degerleri, rate limit veya yasal sure gibi maddeleri DOGRULANDI diye isaretleme.',
    ],
    match: text => has(text, /sap/) && has(text, /iys|ileti yonetim sistemi/),
    signals: text => ({
      systems: [
        has(text, /sap/) ? 'SAP' : '',
        has(text, /crm/) ? 'CRM' : '',
        has(text, /iys/) ? 'IYS' : '',
      ],
      integrations: [
        'Dis API / mevzuat entegrasyonu',
        has(text, /oauth|api/) ? 'API yetkilendirme ve servis entegrasyonu' : '',
      ],
      documentRules: [
        has(text, /mevzuat|kanun|izin/) ? 'Izin, ret ve mevzuat dogrulama kurallari' : '',
      ],
      openTopics: [
        'Resmi IYS/API dokumani ile alan, sure ve durum kurallari dogrulanmali.',
      ],
    }),
  },
  {
    id: 'sap_crm_ai_sales_bot',
    hint: 'ai_sales_bot',
    label: 'SAP CRM AI satis botu',
    projectName: 'SAP CRM AI Satis Botu',
    processTitles: [
      'AI bot ile lead kazanimi ve nitelendirme',
      'Satis temsilcisine devir, handoff ve opportunity yonetimi',
      'AI izleme, guvenlik, KVKK ve performans yonetimi',
    ],
    minProcessCount: 3,
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: [
      'SAP Help Portal CRM / Sales dokumantasyonu',
      'SAP Business AI ve Joule resmi SAP dokumantasyonu',
      'SAP Sales Cloud / CRM lead, opportunity, activity referanslari',
      'KVKK ve kurumsal veri guvenligi politikalari',
      'Guvenilir AI governance ve insan onayi referanslari',
    ],
    researchQueries: [
      'site:help.sap.com SAP CRM sales lead opportunity activity management',
      'site:help.sap.com SAP CRM interaction center sales lead opportunity',
      'site:sap.com SAP Business AI sales CRM assistant Joule',
      'CRM AI sales assistant best practice lead qualification human handoff governance',
    ],
    actInstructions: [
      '- SAP CRM AI satis botu baglaminda su alanlari ozellikle isle: satis kanallari, lead yakalama, lead nitelendirme, opportunity olusturma, activity/task kaydi, temsilciye devir ve musteri etkilesim gecmisi.',
      '- Surecleri ayir: bot karsilama ve niyet anlama, lead/opportunity nitelendirme, teklif/urun oneri akisi, SAP CRM kaydi ve satis temsilcisi handoff, model izleme ve kalite kontrol.',
      '- Kavramsal veri modelinde Business Partner, Contact, Lead, Opportunity, Activity, Campaign, Conversation, Consent, Handoff ve Audit Log varliklarini degerlendir.',
      '- AI davranis kurallarini yaz: guven skoru, insan onayi, hallucination guard, KVKK/veri maskeleme, loglama, prompt/yanit denetimi ve model performans izleme.',
      "- KPI'lari somutlastir: lead donusum orani, ilk yanit suresi, nitelikli lead orani, temsilciye devir basari orani, CRM veri tamligi, CSAT ve satis kapanis etkisi.",
    ],
    match: text => has(text, /sap\s*crm/) && has(text, /ai|yapay zeka|bot|chatbot|asistan|assistant|satis botu|sales bot|lead|opportunity|firsat/),
    signals: () => ({
      systems: ['SAP CRM', 'AI bot/asistan kanali'],
      integrations: ['CRM lead/opportunity/activity veri akisi'],
      risks: ['Dusuk guvenli AI aksiyonlari temsilci onayi olmadan ilerlememeli.'],
    }),
  },
  {
    id: 'field_mobile_app',
    hint: 'field_mobile_app',
    label: 'Saha/mobil uygulama',
    minProcessCount: 4,
    match: text => has(text, /d2d|door to door|door-to-door|saha satis|saha sales|saha uygulama|saha mobil|offline-first|offline|refactor|refaktoring|mobil donusum|mobile donusum/)
      && has(text, /satis|sales|uygulama|app|crm|musteri|ziyaret|rota|lead|teklif/),
    signals: () => ({
      systems: ['Mobil uygulama', 'CRM'],
      integrations: ['Offline-first delta senkronizasyonu'],
      uiNeeds: ['Mobil form, konum/kamera izinleri ve hizli veri girisi'],
      kpis: ['Saha ziyaret tamamlama orani', 'Offline senkronizasyon basari orani'],
    }),
  },
  {
    id: 'digital_contract',
    hint: 'digital_contract',
    label: 'Dijital sozlesme',
    minProcessCount: 3,
    match: text => has(text, /dijital sozlesme|elektronik sozlesme|e-imza|e imza|elektronik imza|mobil imza|otp|uzaktan onay|dijital onay/),
    signals: () => ({
      systems: ['Dijital onay/imza kanali', 'Dokuman yonetimi'],
      integrations: ['Kimlik dogrulama / imza entegrasyonu'],
      documentRules: ['Sozlesme saklama, arsiv ve audit kurallari'],
    }),
  },
  {
    id: 'operations_platform',
    hint: 'operations_platform',
    label: 'Operasyon platformu',
    minProcessCount: 3,
    match: text => has(text, /operasyon platformu|case|talep yonetimi|is listesi|sla|mutabakat|iade|iptal/),
    signals: () => ({
      roles: ['Operasyon', 'Onayci'],
      uiNeeds: ['Operasyon is listesi'],
      kpis: ['SLA uyum orani', 'Hata orani'],
    }),
  },
  {
    id: 'integration_project',
    hint: 'integration_project',
    label: 'Entegrasyon projesi',
    minProcessCount: 3,
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: [
      'Resmi kurum veya urun dokumantasyonu',
      'Uretici API dokumantasyonu',
      'Guvenilir sektor referanslari',
    ],
    match: text => has(text, /entegrasyon|integration|api|servis|middleware|webhook|rest|soap/),
    signals: () => ({
      integrations: ['API / servis entegrasyonu'],
      risks: ['Kaynak/hedef sistem ve veri sahipligi netlesmeden entegrasyon tasarimi kesinlesmemeli.'],
    }),
  },
];

const unique = (values: string[]): string[] => Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));

export function detectDomainProfiles(source = ''): DomainProfile[] {
  const normalized = normalizeDomainText(source);
  return DOMAIN_PROFILES.filter(profile => profile.match(normalized));
}

export function getDomainProfileById(id: DomainProfileId): DomainProfile | undefined {
  return DOMAIN_PROFILES.find(profile => profile.id === id);
}

export function getPrimaryDomainProfile(source = ''): DomainProfile | undefined {
  return detectDomainProfiles(source)[0];
}

export function hasDomainProfile(source = '', id: DomainProfileId): boolean {
  return detectDomainProfiles(source).some(profile => profile.id === id);
}

export function domainHintsForSource(source = ''): string[] {
  return Array.from(new Set(detectDomainProfiles(source).map(profile => profile.hint)));
}

export function profileSignalsForSource(source = ''): DomainSignalContribution {
  const normalized = normalizeDomainText(source);
  return detectDomainProfiles(source).reduce<DomainSignalContribution>((acc, profile) => {
    const signals = profile.signals?.(normalized) || {};
    (Object.keys(signals) as Array<keyof DomainSignalContribution>).forEach((key) => {
      acc[key] = [...(acc[key] || []), ...((signals[key] || []) as string[])];
    });
    return acc;
  }, {});
}

export function inferredProjectNameFromProfile(source = ''): string | undefined {
  return getPrimaryDomainProfile(source)?.projectName;
}

export function processTitlesFromProfile(source = ''): string[] {
  return getPrimaryDomainProfile(source)?.processTitles || [];
}

export function expectedProcessCountFromProfiles(source = '', fallback = 2): number {
  const counts = detectDomainProfiles(source)
    .map(profile => profile.minProcessCount || profile.processTitles?.length || 0)
    .filter(Boolean);
  return counts.length ? Math.max(fallback, ...counts) : fallback;
}

export function preferredSourcesForSource(source = '', fallback: string[] = []): string[] {
  const preferred = detectDomainProfiles(source).flatMap(profile => profile.preferredSources || []);
  return unique(preferred.length ? preferred : fallback);
}

export function researchQueriesForSource(source = '', fallback: string[] = []): string[] {
  const queries = detectDomainProfiles(source).flatMap(profile => profile.researchQueries || []);
  return unique(queries.length ? queries : fallback);
}

export function actInstructionsForSource(source = ''): string[] {
  return unique(detectDomainProfiles(source).flatMap(profile => profile.actInstructions || []));
}

export function sourceSensitiveForSource(source = ''): boolean {
  return detectDomainProfiles(source).some(profile => profile.sourceSensitive);
}

export function requiresExternalResearchForSource(source = ''): boolean {
  return detectDomainProfiles(source).some(profile => profile.requiresExternalResearch);
}
