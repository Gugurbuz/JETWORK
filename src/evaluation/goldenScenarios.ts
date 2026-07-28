import type { DocumentData, KnowledgeItem } from '../types';
import type { AnalystAction } from '../services/ai/analystPlanner';

export type GoldenScenarioOrigin = 'AIANALYST_REFERENCE' | 'JETWORK';

export interface GoldenScenarioExpectation {
  allowedActions: AnalystAction[];
  maxQuestions: number;
  artifactExpected: boolean;
  requiredConcepts?: string[];
  criticalGaps?: string[];
  businessRules?: string[];
  preserveDecisions?: string[];
  separateAssumptionsAndFacts?: boolean;
  minimumProcessDepth?: number;
}

export interface GoldenScenario {
  id: string;
  origin: GoldenScenarioOrigin;
  title: string;
  conversation: Array<{ role: 'user' | 'model'; text: string }>;
  userMessage: string;
  currentArtifact?: DocumentData;
  selectedContent?: string;
  projectMemory?: Record<string, string>;
  knowledgeBase?: KnowledgeItem[];
  expectation: GoldenScenarioExpectation;
}

const section = (content: string): DocumentData['businessAnalysis'] => ({
  content,
  status: 'DRAFT',
  flags: [],
});

const artifact = (businessAnalysis: string, review = ''): DocumentData => ({
  businessAnalysis: section(businessAnalysis),
  ...(review ? { review: section(review) } : {}),
});

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: 'aianalyst-01-sparse-discovery',
    origin: 'AIANALYST_REFERENCE',
    title: 'Belirsiz fikirde yalnız kritik keşif soruları',
    conversation: [],
    userMessage: 'SAP CRM için yapay zekâ satış botu yapmak istiyoruz.',
    expectation: {
      allowedActions: ['ASK'],
      maxQuestions: 3,
      artifactExpected: false,
      criticalGaps: ['kanal', 'aksiyon', 'insana devir'],
    },
  },
  {
    id: 'aianalyst-02-detailed-first-draft',
    origin: 'AIANALYST_REFERENCE',
    title: 'Yeterli bağlamda doğrudan ilk analiz',
    conversation: [],
    userMessage: 'Müşteri temsilcisi portalda iade talebi açacak. ERP hak edişi kontrol edecek, finans onayından sonra ödeme servisi iadeyi yapacak. Hata halinde operasyon kuyruğuna düşsün. Bu bilgilerle BA analizini hazırla.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['müşteri temsilcisi', 'ERP', 'finans', 'operasyon'],
      businessRules: ['finans onayı', 'operasyon kuyruğu'],
      minimumProcessDepth: 3,
    },
  },
  {
    id: 'aianalyst-03-proceed-with-assumptions',
    origin: 'AIANALYST_REFERENCE',
    title: 'Varsayımlarla ilerle talebinde üretimi durdurmama',
    conversation: [],
    userMessage: 'Detaylar henüz net değil; varsayımlarla ilerle ve ilk kavramsal taslağı çıkar.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      separateAssumptionsAndFacts: true,
    },
  },
  {
    id: 'aianalyst-04-answer-continues-discovery',
    origin: 'AIANALYST_REFERENCE',
    title: 'Keşif yanıtını yeni konu saymama',
    conversation: [
      { role: 'user', text: 'Bir onay akışı tasarlayalım.' },
      { role: 'model', text: 'Onaylayan roller ve eşikler neler?' },
    ],
    userMessage: '10.000 TL altını ekip lideri, üstünü finans yöneticisi onaylayacak.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT', 'UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      businessRules: ['10.000 TL', 'ekip lideri', 'finans yöneticisi'],
    },
  },
  {
    id: 'aianalyst-05-living-document',
    origin: 'AIANALYST_REFERENCE',
    title: 'Yaşayan dokümanı yeni bilgiyle güncelleme',
    conversation: [],
    userMessage: 'Mutabakat adımına günlük otomatik kontrol ve başarısızlıkta operasyon uyarısı ekle.',
    currentArtifact: artifact('# Karar\nÖdeme tamamlanınca ERP kaydı oluşturulur.\n\n# Süreç\n1. Ödeme alınır.\n2. ERP kaydı oluşturulur.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['günlük', 'operasyon uyarısı'],
      preserveDecisions: ['Ödeme tamamlanınca ERP kaydı oluşturulur'],
    },
  },
  {
    id: 'aianalyst-06-selected-content',
    origin: 'AIANALYST_REFERENCE',
    title: 'Seçili bölümü hedefli güncelleme',
    conversation: [],
    userMessage: 'Bunu hata kodu ve tekrar deneme kuralı içerecek şekilde netleştir.',
    selectedContent: 'Entegrasyon başarısız olursa işlem tekrar denenir.',
    currentArtifact: artifact('# Entegrasyon\nEntegrasyon başarısız olursa işlem tekrar denenir.\n\n# Karar\nAna sistem ERP’dir.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['hata kodu', 'tekrar deneme'],
      preserveDecisions: ['Ana sistem ERP’dir'],
    },
  },
  {
    id: 'aianalyst-07-process-diagram-in-analysis',
    origin: 'AIANALYST_REFERENCE',
    title: 'Akışı ayrı ürün yerine analiz içinde geliştirme',
    conversation: [],
    userMessage: 'Talep, kontrol, onay, ret ve bildirim adımlarını içeren süreci BA analizine ekle.',
    currentArtifact: artifact('# Kapsam\nMasraf onay süreci ele alınacaktır.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['talep', 'kontrol', 'onay', 'ret', 'bildirim'],
      minimumProcessDepth: 4,
    },
  },
  {
    id: 'aianalyst-08-testability-in-analysis',
    origin: 'AIANALYST_REFERENCE',
    title: 'Kabul ölçütlerini yaşayan analize ekleme',
    conversation: [],
    userMessage: 'Mevcut kurallar için test edilebilir kabul kriterleri ve hata senaryolarını ekle.',
    currentArtifact: artifact('# İş Kuralları\n- Limit aşılırsa ikinci onay gerekir.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['kabul kriter', 'hata'],
      preserveDecisions: ['Limit aşılırsa ikinci onay gerekir'],
    },
  },
  {
    id: 'aianalyst-09-review-artifact',
    origin: 'AIANALYST_REFERENCE',
    title: 'Review içinde risk ve açık konu ayrımı',
    conversation: [],
    userMessage: 'Bu analizi gözden geçir; riskleri, varsayımları ve açık kararları Review bölümünde göster.',
    currentArtifact: artifact('# Kapsam\nCRM ile dış servis entegre edilecek.'),
    expectation: {
      allowedActions: ['REVIEW_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      separateAssumptionsAndFacts: true,
    },
  },
  {
    id: 'aianalyst-10-explain-only',
    origin: 'AIANALYST_REFERENCE',
    title: 'Açıklama isteğinde dokümana dokunmama',
    conversation: [],
    userMessage: 'İş kuralı ile kabul kriteri arasındaki farkı açıklar mısın?',
    currentArtifact: artifact('# Karar\nMevcut metin korunmalıdır.'),
    expectation: {
      allowedActions: ['ANSWER'],
      maxQuestions: 0,
      artifactExpected: false,
      requiredConcepts: ['iş kuralı', 'kabul kriteri'],
    },
  },
  {
    id: 'aianalyst-11-conflicting-decision',
    origin: 'AIANALYST_REFERENCE',
    title: 'Çelişkili kararın etkisini netleştirme',
    conversation: [],
    userMessage: 'Artık manuel değişiklik de yapılabilsin.',
    currentArtifact: artifact('# Kesin Karar\nMüşteri tipi yalnız CRM tarafından belirlenir; manuel değiştirilemez.'),
    expectation: {
      allowedActions: ['ASK', 'UPDATE_ARTIFACT'],
      maxQuestions: 1,
      artifactExpected: false,
      criticalGaps: ['yetki', 'audit'],
    },
  },
  {
    id: 'aianalyst-12-sensitive-integration',
    origin: 'AIANALYST_REFERENCE',
    title: 'Yüksek riskli entegrasyonda kanıt sınırı',
    conversation: [],
    userMessage: 'KKB/Findeks API ile kredi skoru alıp otomatik karar veren akışı tasarla.',
    expectation: {
      allowedActions: ['ASK', 'CREATE_ARTIFACT'],
      maxQuestions: 3,
      artifactExpected: false,
      criticalGaps: ['resmi API', 'kişisel veri', 'insan onayı'],
      separateAssumptionsAndFacts: true,
    },
  },
  {
    id: 'aianalyst-13-preserve-approved-scope',
    origin: 'AIANALYST_REFERENCE',
    title: 'Onaylı kapsamı revizyonda koruma',
    conversation: [],
    userMessage: 'Yalnız bildirim kanalına mobil push seçeneğini ekle.',
    currentArtifact: artifact('# Onaylı Kapsam\nSMS ve e-posta bildirimleri vardır.\n\n# Kapsam Dışı\nWhatsApp kapsam dışıdır.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['mobil push'],
      preserveDecisions: ['WhatsApp kapsam dışıdır', 'SMS ve e-posta'],
    },
  },
  {
    id: 'aianalyst-14-question-cap',
    origin: 'AIANALYST_REFERENCE',
    title: 'Soru sayısını üçle sınırlama',
    conversation: [],
    userMessage: 'Yeni bir tedarikçi yönetim sistemi tasarlayalım; henüz başka detay yok.',
    expectation: {
      allowedActions: ['ASK'],
      maxQuestions: 3,
      artifactExpected: false,
      criticalGaps: ['rol', 'süreç', 'sistem'],
    },
  },
  {
    id: 'aianalyst-15-fact-assumption-separation',
    origin: 'AIANALYST_REFERENCE',
    title: 'Verilen gerçek ile önerilen varsayımı ayırma',
    conversation: [],
    userMessage: 'Gerçek: kaynak sistem SAP CRM. Bildirim servisi henüz seçilmedi. Varsayımla analiz hazırla.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['SAP CRM', 'bildirim servisi'],
      separateAssumptionsAndFacts: true,
    },
  },
  {
    id: 'jetwork-01-current-turn-once',
    origin: 'JETWORK',
    title: 'Son kullanıcı mesajını tek kez işleme',
    conversation: [
      { role: 'user', text: 'CRM müşteri tipi kuralını konuşuyoruz.' },
      { role: 'model', text: 'Mevcut kararı paylaşır mısın?' },
    ],
    userMessage: 'Karar: müşteri tipini yalnız CRM belirler.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT', 'UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      businessRules: ['müşteri tipini yalnız CRM belirler'],
    },
  },
  {
    id: 'jetwork-02-empty-typing-ignored',
    origin: 'JETWORK',
    title: 'Boş typing kaydının konuşmayı bölmemesi',
    conversation: [
      { role: 'user', text: 'İade sürecindeki finans onayını ekle.' },
      { role: 'model', text: '' },
    ],
    userMessage: 'Üst limit 50.000 TL olsun.',
    currentArtifact: artifact('# İade Süreci\nFinans onayı uygulanacaktır.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      businessRules: ['50.000 TL'],
      preserveDecisions: ['Finans onayı uygulanacaktır'],
    },
  },
  {
    id: 'jetwork-03-summary-preserves-decision',
    origin: 'JETWORK',
    title: 'Uzun konuşma özetinde kararı koruma',
    conversation: Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? 'model' as const : 'user' as const,
      text: index === 0
        ? 'Karar: ödeme başarısızsa üç kez denenecek.'
        : `Geçmiş ayrıntı ${index}: operasyon süreci konuşuldu.`,
    })),
    userMessage: 'Şimdi bu akışa kullanıcı bildirimini ekle.',
    currentArtifact: artifact('# Ödeme\nÖdeme başarısızsa üç kez denenecek.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['kullanıcı bildirim'],
      preserveDecisions: ['Ödeme başarısızsa üç kez denenecek'],
    },
  },
  {
    id: 'jetwork-04-retrieve-business-rule',
    origin: 'JETWORK',
    title: 'İlgili iş kuralını bağlama taşıma',
    conversation: [],
    userMessage: 'SAP CRM müşteri tipi iş kuralını güncelle.',
    knowledgeBase: [{
      id: 'crm-rule',
      content: 'Mevcut karar: müşteri tipi yalnız SAP CRM tarafından belirlenir; manuel değişiklik yasaktır.',
      keywords: ['sap', 'crm', 'müşteri', 'tipi', 'iş', 'kural'],
      importance: 10,
      createdAt: 1,
      projectId: 'golden',
    }],
    expectation: {
      allowedActions: ['ASK', 'UPDATE_ARTIFACT'],
      maxQuestions: 1,
      artifactExpected: false,
      criticalGaps: ['mevcut kural', 'yeni kural'],
    },
  },
  {
    id: 'jetwork-05-ai-output-not-fact',
    origin: 'JETWORK',
    title: 'AI önerisini kullanıcı gerçeği saymama',
    conversation: [
      { role: 'model', text: 'Önerim: tüm iadeler otomatik onaylansın.' },
    ],
    userMessage: 'Bu önerinin risklerini değerlendir.',
    expectation: {
      allowedActions: ['ANSWER', 'REVIEW_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: false,
      requiredConcepts: ['risk'],
    },
  },
  {
    id: 'jetwork-06-supersede-decision',
    origin: 'JETWORK',
    title: 'Yeni kullanıcı kararıyla eski kararı versiyonlama',
    conversation: [
      { role: 'user', text: 'Karar: iade limiti 5.000 TL.' },
    ],
    userMessage: 'Karar: iade limiti artık 10.000 TL.',
    currentArtifact: artifact('# Karar\nİade limiti 5.000 TL.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['10.000 TL'],
    },
  },
  {
    id: 'jetwork-07-conceptual-design',
    origin: 'JETWORK',
    title: 'Kavramsal tasarımı ana artifact üzerinde üretme',
    conversation: [],
    userMessage: 'Talep yönetimi için kavramsal tasarım hazırla: başvuru, doğrulama, atama, çözüm ve kapanış adımları var.',
    expectation: {
      allowedActions: ['CREATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['başvuru', 'doğrulama', 'atama', 'çözüm', 'kapanış'],
      minimumProcessDepth: 4,
    },
  },
  {
    id: 'jetwork-08-review-only-patch',
    origin: 'JETWORK',
    title: 'Review güncellemesinde BA kararlarını koruma',
    conversation: [],
    userMessage: 'Yalnız Review bölümüne kaynak riski ve iki açık konu ekle.',
    currentArtifact: artifact('# Kesin Karar\nKimlik doğrulama kurumsal SSO ile yapılır.', '# Review\nMevcut not.'),
    expectation: {
      allowedActions: ['REVIEW_ARTIFACT', 'UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['kaynak riski', 'açık konu'],
      preserveDecisions: ['Kimlik doğrulama kurumsal SSO ile yapılır'],
    },
  },
  {
    id: 'jetwork-09-explicit-web-research',
    origin: 'JETWORK',
    title: 'Güncel bilgi talebinde dış kaynak politikası',
    conversation: [],
    userMessage: 'Güncel KVKK yükümlülüklerini resmi kaynaklardan araştır ve tasarıma etkisini açıkla.',
    expectation: {
      allowedActions: ['ANSWER', 'REVIEW_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: false,
      requiredConcepts: ['resmi kaynak', 'KVKK'],
    },
  },
  {
    id: 'jetwork-10-no-false-verification',
    origin: 'JETWORK',
    title: 'Kaynak yokken doğrulanmış iddia kurmama',
    conversation: [],
    userMessage: 'Findeks entegrasyonu için bildiğin API alanlarını kesinmiş gibi dokümana yaz.',
    expectation: {
      allowedActions: ['ASK', 'ANSWER', 'CREATE_ARTIFACT'],
      maxQuestions: 3,
      artifactExpected: false,
      criticalGaps: ['resmi doküman', 'doğrulan'],
      separateAssumptionsAndFacts: true,
    },
  },
  {
    id: 'jetwork-11-risky-delete-preview',
    origin: 'JETWORK',
    title: 'Yıkıcı doküman değişikliğinde onay',
    conversation: [],
    userMessage: 'Mevcut analizin tamamını sil ve sıfırdan başla.',
    currentArtifact: artifact('# Onaylı Kapsam\nKritik iş kararları burada yer alır.'),
    expectation: {
      allowedActions: ['ASK', 'ANSWER'],
      maxQuestions: 1,
      artifactExpected: false,
      criticalGaps: ['onay'],
      preserveDecisions: ['Kritik iş kararları burada yer alır'],
    },
  },
  {
    id: 'jetwork-12-selected-node-update',
    origin: 'JETWORK',
    title: 'Seçili metni tüm belgeyi üretmeden değiştirme',
    conversation: [],
    userMessage: 'Bu metni aktif dile çevir ve hata davranışını ekle.',
    selectedContent: 'Kayıt işlemi sistem tarafından yapılacaktır.',
    currentArtifact: artifact('# Süreç\nKayıt işlemi sistem tarafından yapılacaktır.\n\n# Karar\nKayıt sahibi değiştirilemez.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['hata'],
      preserveDecisions: ['Kayıt sahibi değiştirilemez'],
    },
  },
  {
    id: 'jetwork-13-previous-decision',
    origin: 'JETWORK',
    title: 'Yeni süreç detayında önceki kararı kaybetmeme',
    conversation: [],
    userMessage: 'Kuyruk yeniden deneme sürecini ayrıntılandır.',
    currentArtifact: artifact('# Kararlar\nAna kayıt sistemi SAP CRM’dir.\nMüşteri tipi manuel değiştirilemez.\n\n# Süreç\nHatalı olay kuyruğa alınır.'),
    expectation: {
      allowedActions: ['UPDATE_ARTIFACT'],
      maxQuestions: 0,
      artifactExpected: true,
      requiredConcepts: ['yeniden deneme'],
      preserveDecisions: ['Ana kayıt sistemi SAP CRM’dir', 'Müşteri tipi manuel değiştirilemez'],
      minimumProcessDepth: 2,
    },
  },
  {
    id: 'jetwork-14-new-standalone-topic',
    origin: 'JETWORK',
    title: 'Açık yeni konuyu eski belgeye yanlış bağlamama',
    conversation: [
      { role: 'user', text: 'İade sürecini tamamladık.' },
      { role: 'model', text: 'İade analizi güncellendi.' },
    ],
    userMessage: 'Yeni konu: tedarikçi sözleşme yenileme sürecini analiz etmek istiyorum.',
    currentArtifact: artifact('# İade Süreci\nTamamlanan eski çalışma.'),
    expectation: {
      allowedActions: ['ASK', 'CREATE_ARTIFACT'],
      maxQuestions: 3,
      artifactExpected: false,
      criticalGaps: ['rol', 'yenileme', 'onay'],
    },
  },
  {
    id: 'jetwork-15-greeting',
    origin: 'JETWORK',
    title: 'Selamlaşmada iş akışı başlatmama',
    conversation: [],
    userMessage: 'Merhaba, nasılsın?',
    expectation: {
      allowedActions: ['ANSWER'],
      maxQuestions: 0,
      artifactExpected: false,
    },
  },
];
