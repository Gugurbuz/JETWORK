import type {
  DocumentRule,
  FlowStep,
  IntegrationReference,
  KpiDefinition,
  ProcessModel,
  Requirement,
  UiMessage,
} from './conceptualDesignTypes';

export interface ProcessSeed {
  id?: string;
  code?: string;
  title: string;
  purpose?: string;
  description?: string;
  actor?: string;
  screens?: string[];
  requiredDocuments?: Array<Partial<DocumentRule> & { documentName: string }>;
  integrations?: Array<Partial<IntegrationReference> & { system: string }>;
  businessRules?: string[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'process';
}

function createDefaultFlowSteps(processId: string, actor: string, title: string): FlowStep[] {
  return [
    {
      id: `${processId}-start`,
      order: 1,
      type: 'start',
      actor,
      title: 'Süreç başlatılır',
      description: `${title} süreci kullanıcı aksiyonu veya iş akışı koşulu ile başlatılır.`,
      nextStepIds: [`${processId}-review`],
    },
    {
      id: `${processId}-review`,
      order: 2,
      type: 'activity',
      actor,
      title: 'Kayıt ve görevler kontrol edilir',
      description: 'Süreç kapsamındaki zorunlu alanlar, görevler ve doküman kuralları kontrol edilir.',
      nextStepIds: [`${processId}-decision`],
    },
    {
      id: `${processId}-decision`,
      order: 3,
      type: 'decision',
      actor: 'JetPS Sistem',
      title: 'Tamamlama koşulları sağlandı mı?',
      description: 'Zorunlu adımlar, görevler ve doküman kuralları değerlendirilir.',
      nextStepIds: [`${processId}-complete`, `${processId}-block`],
    },
    {
      id: `${processId}-block`,
      order: 4,
      type: 'notification',
      actor: 'JetPS Sistem',
      title: 'Eksik bilgi uyarısı gösterilir',
      description: 'Eksik bilgi, görev veya doküman varsa kullanıcıya bloklayıcı mesaj gösterilir.',
      nextStepIds: [`${processId}-review`],
    },
    {
      id: `${processId}-complete`,
      order: 5,
      type: 'end',
      actor: 'JetPS Sistem',
      title: 'Süreç tamamlanır',
      description: 'Süreç tamamlandı olarak işaretlenir, ilerleme oranı güncellenir ve audit log oluşturulur.',
      nextStepIds: [],
    },
  ];
}

function createDefaultRequirements(processId: string, title: string): Requirement[] {
  return [
    {
      id: 'BR-TEMP',
      category: 'BR',
      title: `${title} iş kuralı`,
      statement: `${title} süreci, yetkili kullanıcıların kapsamındaki projeler için yönetilebilir olmalıdır.`,
      priority: 'Must',
      acceptanceCriteria: [
        'Yetkili kullanıcı ilgili süreci görüntüleyebilmelidir.',
        'Yetkisiz kullanıcı işlem yapmaya çalıştığında uyarı mesajı görmelidir.',
      ],
      relatedProcessIds: [processId],
      status: 'Draft',
    },
    {
      id: 'FR-TEMP',
      category: 'FR',
      title: `${title} süreç tamamlama`,
      statement: `${title} sürecinde zorunlu adımlar, görevler ve dokümanlar tamamlandığında süreç tamamlandı olarak işaretlenebilmelidir.`,
      priority: 'Must',
      acceptanceCriteria: [
        'Zorunlu kontroller başarılı ise süreç tamamlandı durumuna geçer.',
        'Zorunlu kontroller başarısız ise işlem engellenir ve kullanıcıya neden gösterilir.',
      ],
      relatedProcessIds: [processId],
      status: 'Draft',
    },
  ];
}

function createDefaultKpis(processId: string, title: string): KpiDefinition[] {
  return [
    {
      id: `${processId}-kpi-completion`,
      name: `${title} tamamlanma oranı`,
      description: `${title} sürecindeki tamamlanan adım/görev/doküman ağırlıklarının toplam ilerlemeye etkisini gösterir.`,
      formula: 'Tamamlanan ağırlık / Toplam süreç ağırlığı * 100',
      unit: '%',
      target: 'Süreç kurallarına göre %100',
      dataSource: 'JetPS süreç, görev ve doküman kayıtları',
      relatedProcessIds: [processId],
    },
    {
      id: `${processId}-kpi-delay`,
      name: `${title} gecikme durumu`,
      description: 'Süreç hedef tarihine göre geciken kayıt sayısını izler.',
      formula: 'Hedef tarihi geçmiş ve tamamlanmamış süreç sayısı',
      unit: 'adet',
      target: '0',
      dataSource: 'JetPS süreç tarihleri',
      relatedProcessIds: [processId],
    },
  ];
}

function createDefaultUiMessages(processId: string, title: string, screens: string[]): UiMessage[] {
  const screen = screens[0] || `${title} Detay Ekranı`;
  return [
    {
      id: `${processId}-msg-success`,
      screen,
      trigger: 'Süreç tamamlama başarılı olduğunda',
      type: 'success',
      title: 'Süreç tamamlandı',
      message: `${title} süreci başarıyla tamamlandı. İlerleme oranı güncellendi.`,
      userAction: 'Proje detayına dön',
      blocking: false,
      relatedRequirementIds: [],
    },
    {
      id: `${processId}-msg-blocked`,
      screen,
      trigger: 'Zorunlu görev veya doküman eksik olduğunda',
      type: 'modal',
      title: 'Süreç tamamlanamaz',
      message: 'Zorunlu görevler veya dokümanlar tamamlanmadan süreç tamamlanamaz.',
      userAction: 'Eksikleri tamamla',
      blocking: true,
      relatedRequirementIds: [],
    },
  ];
}

function normalizeDocumentRules(processId: string, requiredDocuments: ProcessSeed['requiredDocuments'] = []): DocumentRule[] {
  return requiredDocuments.map((document, index) => ({
    id: document.id || `${processId}-doc-${index + 1}`,
    documentName: document.documentName,
    documentType: document.documentType || document.documentName,
    required: document.required ?? true,
    allowedExtensions: document.allowedExtensions?.length ? document.allowedExtensions : ['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'],
    ownerRole: document.ownerRole,
    retentionTarget: document.retentionTarget,
    integrationTarget: document.integrationTarget || 'FileNet',
    completionImpact: document.completionImpact || 'Zorunlu ise süreç tamamlanmasını etkiler.',
  }));
}

function normalizeIntegrations(processId: string, integrations: ProcessSeed['integrations'] = []): IntegrationReference[] {
  return integrations.map((integration, index) => ({
    id: integration.id || `${processId}-int-${index + 1}`,
    system: integration.system,
    direction: integration.direction || 'outbound',
    trigger: integration.trigger || 'workflow-condition',
    payloadSummary: integration.payloadSummary,
    successBehavior: integration.successBehavior || 'Başarılı entegrasyon sonucu süreç/görev/doküman durumu güncellenir.',
    errorBehavior: integration.errorBehavior || 'Hata durumunda kullanıcı bilgilendirilir, retry/audit kaydı oluşturulur.',
  }));
}

export function buildProcessModelFromSeed(seed: ProcessSeed, index = 0): ProcessModel {
  const id = seed.id || `process-${slugify(seed.title)}`;
  const actor = seed.actor || 'Yetkili Kullanıcı';
  const title = seed.title.trim();

  return {
    id,
    code: seed.code,
    title,
    purpose: seed.purpose || `${title} sürecinin JetPS üzerinde uçtan uca takip edilmesini sağlamak.`,
    highLevelDescription: seed.description || `${title} süreci; iş kuralları, görevler, zorunlu dokümanlar, entegrasyonlar ve ilerleme hesabı ile yönetilir.`,
    businessRules: seed.businessRules?.length
      ? seed.businessRules
      : [
        'Süreç görünürlüğü ve işlem yetkileri rol bazında kontrol edilir.',
        'Zorunlu görev veya doküman tamamlanmadan ilgili süreç tamamlandı durumuna geçemez.',
        'Tüm kritik işlemler audit log’a yazılır.',
      ],
    businessRequirements: createDefaultRequirements(id, title),
    kpis: createDefaultKpis(id, title),
    flowSteps: createDefaultFlowSteps(id, actor, title).map(step => ({ ...step, order: step.order + index * 10 })),
    uiMessages: createDefaultUiMessages(id, title, seed.screens || []),
    documentRules: normalizeDocumentRules(id, seed.requiredDocuments),
    integrations: normalizeIntegrations(id, seed.integrations),
    screenshots: (seed.screens || []).map((screen, screenIndex) => ({
      id: `${id}-screen-${screenIndex + 1}`,
      title: screen,
      relatedSection: title,
    })),
    openQuestions: [],
  };
}

export function buildProcessModelsFromSeeds(seeds: ProcessSeed[]): ProcessModel[] {
  return seeds.map((seed, index) => buildProcessModelFromSeed(seed, index));
}

export function inferProcessSeedsFromNotes(notes: string): ProcessSeed[] {
  const fallbackSeeds: ProcessSeed[] = [
    { title: 'Proje Yönetimi', screens: ['Projeler', 'Yeni Proje Oluştur', 'Proje Detay'] },
    { title: 'Süreç ve Görev Yönetimi', screens: ['Süreç Detayı', 'Görev Merkezi'] },
    { title: 'Doküman Yönetimi', screens: ['Doküman Merkezi'], integrations: [{ system: 'FileNet' }] },
    { title: 'Bildirim Yönetimi', screens: ['Bildirimler'] },
    { title: 'Yetki ve Kullanıcı Yönetimi', screens: ['Rol Yönetimi', 'Kullanıcı Yönetimi'] },
  ];

  const lower = notes.toLowerCase();
  const seeds = [...fallbackSeeds];

  if (lower.includes('dashboard') || lower.includes('kpi')) {
    seeds.push({ title: 'Dashboard ve Raporlama', screens: ['Genel Dashboard', 'Kurulum Takibi'] });
  }

  if (lower.includes('master data') || lower.includes('sistem tanım')) {
    seeds.push({ title: 'Master Data Yönetimi', screens: ['Master Data'] });
  }

  if (lower.includes('sistem ayar') || lower.includes('oturum')) {
    seeds.push({ title: 'Sistem Ayarları ve Oturum Yönetimi', screens: ['Sistem Ayarları'] });
  }

  return seeds;
}
