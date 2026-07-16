import type { ArtifactMode } from './baCognitiveFrame';
import type { BaAgentFocus } from './intentTypes';

export type ArtifactProfileId =
  | 'none'
  | 'discovery_brief'
  | 'conceptual_design_standard'
  | 'conceptual_design_process_heavy'
  | 'technical_analysis'
  | 'test_scenario'
  | 'review_report'
  | 'ui_specification'
  | 'api_specification';

export type ProcessModelPolicy = 'none' | 'source_driven' | 'required_for_profile';

export interface ArtifactProfile {
  id: ArtifactProfileId;
  label: string;
  requiredSections: string[];
  optionalSections: string[];
  forbiddenSections: string[];
  processModelPolicy: ProcessModelPolicy;
  promptRules: string[];
}

const SHARED_VISIBLE_SURFACE_RULES = [
  'Gorunur dokuman yuzeyi businessAnalysis ve review alanlaridir.',
  'code/test/bpmn alanlari yeni uretimde ana yuzey gibi kullanilmaz.',
  'Kaynakta olmayan bilgi kesin karar gibi yazilmaz; DOGRULANDI, CIKARIM, VARSAYIM, ACIK KONU ayrimi korunur.',
];

export const ARTIFACT_PROFILES: Record<ArtifactProfileId, ArtifactProfile> = {
  none: {
    id: 'none',
    label: 'Dokuman yok',
    requiredSections: [],
    optionalSections: [],
    forbiddenSections: ['businessAnalysis', 'review', 'code', 'test', 'bpmn'],
    processModelPolicy: 'none',
    promptRules: [
      'Bu turda dokuman uretme veya guncelleme.',
      'Kisa, dogal ve kullanici niyetine uygun sohbet cevabi ver.',
    ],
  },
  discovery_brief: {
    id: 'discovery_brief',
    label: 'On kesif',
    requiredSections: ['Kisa niyet ozeti', 'Kritik karar sorulari'],
    optionalSections: ['Varsayim adaylari', 'Kaynak ihtiyaci'],
    forbiddenSections: ['Tam kavramsal tasarim', 'Nihai kalite puani'],
    processModelPolicy: 'none',
    promptRules: [
      'Tam dokuman uretme; once problem, mevcut durum, hedef, kritik karar ve kaynak ihtiyacini netlestir.',
      'Soru sayisini yuksek etkili ve geri donusu pahali kararlara indir.',
    ],
  },
  conceptual_design_standard: {
    id: 'conceptual_design_standard',
    label: 'Kavramsal tasarim',
    requiredSections: [
      'KAVRAMSAL TASARIM RAPORU',
      'Proje Kimlik Karti',
      'Amac',
      'Kapsam',
      'As-Is / To-Be',
      'Is Gerekleri ve KPIs',
      'UAT / Kabul Kriterleri',
      'Review',
    ],
    optionalSections: [
      'Surec modeli bloklari',
      'Ekran / validasyon / mesajlar',
      'Veri ve entegrasyon',
      'Degisim yonetimi',
      'Onay tablolari',
      'EK A',
    ],
    forbiddenSections: ['Alakasiz domain sablonlari', 'Eski code/test/bpmn sekme zorlama'],
    processModelPolicy: 'source_driven',
    promptRules: [
      'Kavramsal tasarim iskeletini kur ama kaynakta olmayan surec adlarini sabit kalip gibi dayatma.',
      'Surec modeli gerekiyorsa kaynak sinyallerinden uret; kaynak yoksa generic kalibi Reviewda varsayim olarak ayir.',
    ],
  },
  conceptual_design_process_heavy: {
    id: 'conceptual_design_process_heavy',
    label: 'Surec agirlikli kavramsal tasarim',
    requiredSections: [
      'KAVRAMSAL TASARIM RAPORU',
      'Proje Kimlik Karti',
      'Dokuman Tarihcesi',
      'Surec Tasarimi',
      'SUREC MODELI bloklari',
      'Is Gerekleri ve KPIs',
      'Ust Duzey Musteri Gelistirmesi',
      'Onemli Uyarlamalar',
      'Degisim Yonetimi',
      'EK A',
    ],
    optionalSections: ['Mermaid akis taslagi', 'Traceability matrisi', 'Kaynak dogrulama matrisi'],
    forbiddenSections: ['Baska proje/domain surec adlari'],
    processModelPolicy: 'required_for_profile',
    promptRules: [
      'Bu profil yalniz kullanici kavramsal tasarim/Word yapisi veya surec modeli derinligi beklediginde kullanilir.',
      'Her surec modeli blogu kaynak sinyaline veya acik varsayima baglanmalidir.',
    ],
  },
  technical_analysis: {
    id: 'technical_analysis',
    label: 'Teknik analiz',
    requiredSections: ['Bilesenler', 'Veri modeli', 'Entegrasyon', 'Hata yonetimi', 'Guvenlik', 'Loglama', 'NFR'],
    optionalSections: ['API sozlesmesi', 'Deployment', 'Monitoring', 'Rollback'],
    forbiddenSections: ['Kavramsal Word onay tablolari zorlamasi'],
    processModelPolicy: 'source_driven',
    promptRules: [
      'Teknik detaylari businessAnalysis icinde alt baslik olarak yaz.',
      'Calistirilmayan test/build sonucunu kanit gibi yazma.',
    ],
  },
  test_scenario: {
    id: 'test_scenario',
    label: 'Test senaryosu',
    requiredSections: ['On kosul', 'Test verisi', 'Adimlar', 'Beklenen sonuc', 'Negatif senaryo', 'UAT kabul'],
    optionalSections: ['Sinir deger', 'Yetki testi', 'Regresyon'],
    forbiddenSections: ['Gereksiz kavramsal Word kapagi'],
    processModelPolicy: 'none',
    promptRules: [
      'Test ciktisinda her senaryo testlenebilir veri ve beklenen sonuc icermelidir.',
      'Is kurali ve kabul kriteri baglantisini koru.',
    ],
  },
  review_report: {
    id: 'review_report',
    label: 'Review raporu',
    requiredSections: ['Kalite puani', 'Riskler', 'Acik konular', 'Varsayimlar', 'Hizli aksiyonlar'],
    optionalSections: ['Kaynak dogrulama', 'Traceability', 'Coverage'],
    forbiddenSections: ['Ana dokumani gizlice yeniden yazma'],
    processModelPolicy: 'none',
    promptRules: [
      'Review modu ana dokumani degistirmez; bulgu, risk ve aksiyon uretir.',
      'Puan gerekcesini kullanicinin anlayacagi sekilde acikla.',
    ],
  },
  ui_specification: {
    id: 'ui_specification',
    label: 'UI spesifikasyonu',
    requiredSections: ['Ekran amaci', 'Kullanici aksiyonlari', 'State modeli', 'Validasyon', 'Mesajlar'],
    optionalSections: ['Bos durum', 'Hata durumu', 'Yetki', 'Erisilebilirlik'],
    forbiddenSections: ['Backend/API kesin karari uydurma'],
    processModelPolicy: 'none',
    promptRules: [
      'Ekran davranisini alan, state, validasyon, toast/modal ve yetki seviyesinde yaz.',
      'Tasarim sistemi bilinmiyorsa varsayim olarak ayir.',
    ],
  },
  api_specification: {
    id: 'api_specification',
    label: 'API spesifikasyonu',
    requiredSections: ['Endpoint', 'Auth', 'Request', 'Response', 'Hata kodlari', 'Idempotency', 'Rate limit'],
    optionalSections: ['Webhook', 'Versiyonlama', 'Contract test', 'Monitoring'],
    forbiddenSections: ['Resmi API dokumani yokken DOGRULANDI iddiasi'],
    processModelPolicy: 'source_driven',
    promptRules: [
      'API iddialarinda resmi/kurum dokumani yoksa DOGRULANDI etiketi kullanma.',
      'Senkron/asenkron, retry ve hata davranisini acik konu veya varsayimla ayir.',
    ],
  },
};

export function selectArtifactProfile(input: {
  artifactMode?: ArtifactMode;
  focus?: BaAgentFocus;
  wantsCorporateTemplate?: boolean;
  sourceHasProcesses?: boolean;
}): ArtifactProfile {
  if (input.focus === 'review' || input.focus === 'quality') return ARTIFACT_PROFILES.review_report;
  if (input.focus === 'test' || input.artifactMode === 'test_scenario') return ARTIFACT_PROFILES.test_scenario;
  if (input.focus === 'technical_analysis' || input.artifactMode === 'technical_analysis') return ARTIFACT_PROFILES.technical_analysis;
  if (input.artifactMode === 'api_specification') return ARTIFACT_PROFILES.api_specification;
  if (input.artifactMode === 'ui_specification') return ARTIFACT_PROFILES.ui_specification;
  if (input.wantsCorporateTemplate || input.sourceHasProcesses || input.artifactMode === 'process_design') {
    return ARTIFACT_PROFILES.conceptual_design_process_heavy;
  }
  if (input.artifactMode === 'conceptual_analysis') return ARTIFACT_PROFILES.conceptual_design_standard;
  return ARTIFACT_PROFILES.none;
}

export function renderArtifactProfileInstruction(profile: ArtifactProfile): string {
  return [
    '[ARTIFACT PROFILE]',
    `- Id: ${profile.id}`,
    `- Etiket: ${profile.label}`,
    `- Surec modeli politikasi: ${profile.processModelPolicy}`,
    `- Zorunlu bolumler: ${profile.requiredSections.join(' | ') || 'yok'}`,
    `- Opsiyonel bolumler: ${profile.optionalSections.join(' | ') || 'yok'}`,
    `- Yasak/istenmeyen kaliplar: ${profile.forbiddenSections.join(' | ') || 'yok'}`,
    ...SHARED_VISIBLE_SURFACE_RULES.map(rule => `- ${rule}`),
    ...profile.promptRules.map(rule => `- ${rule}`),
  ].join('\n');
}
