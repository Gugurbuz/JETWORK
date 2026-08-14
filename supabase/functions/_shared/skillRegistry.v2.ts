type CapabilityPriority = 'P0' | 'P1' | 'P2'

interface CapabilityFamilyDefinition {
  title: string
  category: string
  priority: CapabilityPriority
  tools: string[]
  procedure: string[]
  skills: string[]
}

const humanize = (value: string) => value
  .split('-')
  .filter(Boolean)
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ')

const FAMILY_DEFINITIONS: Record<string, CapabilityFamilyDefinition> = {
  agent: {
    title: 'Agent / Orchestration', category: 'agent', priority: 'P0', tools: ['reasoning', 'skills', 'tools'],
    procedure: ['Görev niyetini, kapsamını ve başarı ölçütünü belirle.', 'Gereken skill ve tool zincirini en küçük yeterli planla seç.', 'Ara sonuçları takip et; başarısız adımı güvenli biçimde yeniden planla.', 'Finalden önce tamamlık ve tutarlılık kontrolü yap.'],
    skills: ['intent-detection','complexity-assessment','task-decomposition','task-planning','skill-selection','tool-selection','multi-skill-orchestration','context-resolution','clarification-decision','progress-tracking','retry-strategy','failure-recovery'],
  },
  reasoning: {
    title: 'Reasoning / Decision', category: 'reasoning', priority: 'P0', tools: ['reasoning'],
    procedure: ['Karar sorusunu, seçenekleri ve kısıtları ayır.', 'Doğrudan kanıt, hesaplama ve çıkarımı birbirinden ayır.', 'Alternatifleri aynı kriter setiyle karşılaştır.', 'Sonucu gerekçe, risk ve belirsizlikleriyle birlikte üret.'],
    skills: ['compare-options','root-cause-reasoning','cause-effect-analysis','pros-cons-analysis','decision-matrix','prioritization','tradeoff-analysis','scenario-analysis','what-if-analysis','constraint-analysis'],
  },
  knowledge: {
    title: 'Knowledge / RAG / Grounding', category: 'knowledge', priority: 'P0', tools: ['knowledge', 'rag', 'citations'],
    procedure: ['Sorunun kurumsal veya güncel kanıt gerektirip gerektirmediğini belirle.', 'Arama adayını kanıt sayma; exact/detail evidence ile doğrula.', 'Kaynak otoritesi, güncelliği ve çelişkileri kontrol et.', 'Cevaptaki kritik iddiaların kanıt kapsamını doğrula.'],
    skills: ['source-decision','enterprise-knowledge-detection','general-knowledge-decision','query-generation','query-expansion','result-ranking','evidence-selection','multi-source-synthesis','source-conflict-resolution','source-freshness-check','source-authority-check','citation-generation','citation-coverage-check','grounded-answer-generation','hallucination-check','insufficient-evidence-handling'],
  },
  research: {
    title: 'Web / Research', category: 'research', priority: 'P1', tools: ['web', 'research'],
    procedure: ['Araştırma sorusunu doğrulanabilir alt sorulara böl.', 'Birincil ve resmi kaynakları önceliklendir.', 'Güncel bilgi ile tarihsel bilgiyi ayır.', 'Kaynaklar arası uyuşmazlığı görünür kılarak sentezle.'],
    skills: ['web-search','source-discovery','fact-verification','multi-source-research','current-information-check','official-source-prioritization','competitor-research','market-research','technology-research','regulation-research'],
  },
  data: {
    title: 'Data Analysis', category: 'data', priority: 'P1', tools: ['data-analysis', 'python', 'spreadsheet'],
    procedure: ['Veri setinin şemasını, hacmini ve kalite problemlerini incele.', 'Metrik, boyut ve zaman referansını açıkça tanımla.', 'Hesaplamaları deterministik ve yeniden üretilebilir uygula.', 'Özet sonuçları kaynak toplamlarıyla reconcile et.'],
    skills: ['profiling','descriptive-analysis','aggregation','segmentation','trend-analysis','anomaly-detection','outlier-analysis','correlation-analysis','distribution-analysis','cohort-analysis','time-series-analysis','reconciliation'],
  },
  files: {
    title: 'File Intelligence', category: 'files', priority: 'P1', tools: ['files', 'documents'],
    procedure: ['Dosya türünü ve gerçek içeriğini metadata ile birlikte doğrula.', 'Dosyalar arası ilişkiyi isimden değil içerikten kur.', 'Karşılaştırma ve diff sırasında format farkı ile içerik farkını ayır.', 'Okunamayan veya desteklenmeyen bölümleri açıkça raporla.'],
    skills: ['type-detection','content-extraction','metadata-analysis','relationship-detection','multi-file-analysis','comparison','diff','classification','duplicate-detection','quality-check'],
  },
  spreadsheet: {
    title: 'Spreadsheet', category: 'spreadsheet', priority: 'P0', tools: ['spreadsheet', 'xlsx'],
    procedure: ['Workbook ve ilgili sheet yapısını değişiklikten önce inspect et.', 'İşlemi mümkün olan en dar hücre/satır/kolon aralığında uygula.', 'Formül, stil, sheet sırası ve mevcut workbook davranışını gereksiz yere değiştirme.', 'Çıktıyı yeniden açarak hücre, yapı ve artifact QA doğrulaması yap.'],
    skills: ['inspect','schema-detect','type-inference','cell-value-edit','row-column-edit','data-cleaning','column-normalization','filter-sort','table-join','fuzzy-match','deduplicate','formula','aggregation','pivot','formatting','conditional-formatting','chart','sheet-management','workbook-create','workbook-export','format-preserve','quality-check','change-report','jira-sync'],
  },
  pdf: {
    title: 'PDF', category: 'pdf', priority: 'P1', tools: ['pdf', 'files'],
    procedure: ['PDF sayfa ve içerik yapısını inspect et.', 'Metin, tablo, görsel ve layout bilgisini birbirinden ayır.', 'Düzenleme gerekiyorsa yalnız hedef sayfa/alan üzerinde işlem yap.', 'Üretilen PDFyi yeniden açıp sayfa sayısı ve dosya bütünlüğünü doğrula.'],
    skills: ['inspect','text-extract','table-extract','image-extract','visual-analysis','layout-analysis','page-selection','summarize','compare','annotate','merge','split'],
  },
  document: {
    title: 'Word / Documents', category: 'document', priority: 'P1', tools: ['docx', 'documents'],
    procedure: ['Belgenin başlık, paragraf, tablo ve görsel yapısını inspect et.', 'İstenen revizyonu bölüm sınırlarını ve mevcut stili koruyarak uygula.', 'Mevcut içerik ile yeni içeriğin provenanceını karıştırma.', 'Çıktıyı yeniden açarak yapı ve teslim QA kontrolü yap.'],
    skills: ['inspect','structure-extract','summarize','rewrite','section-edit','style-preserve','table-edit','image-insert','heading-management','toc-management','generate','compare'],
  },
  presentation: {
    title: 'Presentation', category: 'presentation', priority: 'P1', tools: ['pptx', 'presentation'],
    procedure: ['Deck yapısını, tema dilini ve slayt amacını inspect et.', 'Hikaye akışını tek slayt değil bütün deck bağlamında kur.', 'Layout, grafik ve görselleri mesaj hiyerarşisine göre yerleştir.', 'Taşma, okunabilirlik, tutarlılık ve kaynak QA kontrolü yap.'],
    skills: ['inspect','structure-analysis','storytelling','slide-generation','slide-edit','layout','theme-preserve','chart-selection','chart-generation','diagram-generation','image-placement','quality-check'],
  },
  image: {
    title: 'Image / Vision', category: 'image', priority: 'P1', tools: ['vision', 'image'],
    procedure: ['Görselin türünü, çözünürlüğünü ve ana içeriğini belirle.', 'Metin, UI, diagram, chart ve fotoğraf yorumunu uygun yöntemle ayır.', 'Düzenleme isteğinde yalnız istenen görsel değişiklikleri uygula.', 'Çıktıda boyut, görünürlük ve temel kalite kontrolü yap.'],
    skills: ['inspect','visual-understanding','screenshot-analysis','ui-analysis','diagram-understanding','chart-understanding','table-understanding','compare-images','generate','edit','crop-resize','annotate'],
  },
  'business-analysis': {
    title: 'Business Analysis', category: 'business-analysis', priority: 'P0', tools: ['business-analysis', 'knowledge'],
    procedure: ['İş hedefi, aktör, kapsam ve mevcut kanıtı ayır.', 'Gereksinim, kural, istisna, bağımlılık ve açık noktaları sistematik çıkar.', 'As-is gerçekleri ile to-be önerilerini karıştırma.', 'Çıktıyı test edilebilirlik, izlenebilirlik ve uygulanabilirlik açısından doğrula.'],
    skills: ['requirement-understanding','requirement-decomposition','requirement-gap-analysis','requirement-conflict-analysis','business-rule-extraction','acceptance-criteria','as-is','to-be','gap-analysis','impact-analysis','dependency-analysis','risk-analysis','assumption-management','open-question-generation','scope-definition','process-analysis','process-flow','use-case','user-story','functional-analysis','technical-analysis','solution-option-analysis'],
  },
  architecture: {
    title: 'Process / Architecture', category: 'architecture', priority: 'P1', tools: ['architecture', 'diagram'],
    procedure: ['Sistem sınırı, aktör, bileşen ve veri akışı seviyesini seç.', 'Kanıtlanan bileşenleri ve ilişkileri doğru yönde bağla.', 'Sequence, component, context ve data-flow görünümlerini birbirine karıştırma.', 'Diyagramın ad, ok yönü ve kapsam tutarlılığını doğrula.'],
    skills: ['process-flow','sequence-diagram','system-context','component-diagram','integration-map','data-flow','dependency-map','topology','api-flow','event-flow'],
  },
  jira: {
    title: 'Agile / Jira / Product', category: 'jira', priority: 'P0', tools: ['jira', 'spreadsheet'],
    procedure: ['Issue key, status, sprint ve hierarchy alanlarını gerçek kaynaktan doğrula.', 'Planlama metriği ile iş bağımlılığını birbirinden ayır.', 'Duplicate, missing ve geçmiş değerleri sessizce ezme.', 'Çıktı toplamlarını backlog ve kapasite verileriyle reconcile et.'],
    skills: ['issue-read','issue-match','status-normalize','sprint-extract','latest-sprint','aging','comment-analysis','backlog-quality','story-quality','sprint-analysis','velocity-analysis','capacity-analysis','dependency-analysis','roadmap-analysis','epic-analysis','release-readiness'],
  },
  sap: {
    title: 'SAP / Enterprise Technical', category: 'sap', priority: 'P0', tools: ['knowledge', 'code-analysis'],
    procedure: ['Exact SAP identifierı ve nesne tipini enterprise evidence ile doğrula.', 'Source, relation ve mesaj kanıtını ayrı tut.', 'Call-chain ve data-flow çıkarımlarını kanıtlanan hoplarla sınırla.', 'Doğrulanmayan class/method/message/table ayrıntısı uydurma.'],
    skills: ['object-recognition','code-analysis','method-analysis','call-chain-analysis','message-analysis','table-relationship','data-flow-analysis','integration-analysis','crm-process-analysis','root-cause-diagnosis'],
  },
  engineering: {
    title: 'Engineering / Code', category: 'engineering', priority: 'P1', tools: ['repository', 'code-analysis'],
    procedure: ['Repo ve ilgili runtime sınırını mevcut kod üzerinden doğrula.', 'Kök neden ile semptomu ayır ve değişiklik yüzeyini minimumda tut.', 'Değişiklik öncesi regression etkisini ve test kontratını belirle.', 'Implementasyon sonrası typecheck, test, build ve runtime doğrulaması yap.'],
    skills: ['repository-analysis','code-search','dependency-analysis','bug-diagnosis','change-planning','implementation','refactoring','test-generation','regression-analysis','code-review'],
  },
  artifact: {
    title: 'Artifact Generation', category: 'artifact', priority: 'P1', tools: ['files', 'artifact'],
    procedure: ['Kullanıcı için doğru çıktı formatını ve mevcut template gereksinimini belirle.', 'Artifactı güvenli workspace storage altında üret.', 'Dosya referansını assistant mesajına tool_output olarak bağla.', 'Teslimden önce format ve içerik QA kontrolü yap.'],
    skills: ['choose-output-format','create-file','edit-existing-file','preserve-template','version-output','attach-output','secure-download','validate-output'],
  },
  automation: {
    title: 'Automation / Actions', category: 'automation', priority: 'P2', tools: ['automation', 'connectors'],
    procedure: ['Aksiyonun tetikleyici, kapsam ve yetki gereksinimini belirle.', 'Yan etkili işlemlerde idempotency ve retry davranışını tanımla.', 'Onay gerektiren adımları otomatik yürütme.', 'Her aksiyonun sonucu ve hata durumunu audit edilebilir tut.'],
    skills: ['schedule','condition-watch','recurring-task','notification','workflow-trigger','retry','approval-gate','action-audit'],
  },
  communication: {
    title: 'Communication', category: 'communication', priority: 'P1', tools: ['writing'],
    procedure: ['Hedef kitle, amaç ve karar/aksiyon beklentisini belirle.', 'Teknik ayrıntı seviyesini alıcıya göre ayarla.', 'Kaynakta olmayan kesinlik veya taahhüt ekleme.', 'Mesajı açıklık, ton ve aksiyon netliği açısından kontrol et.'],
    skills: ['email-draft','executive-summary','meeting-summary','action-items','management-message','stakeholder-message','technical-to-business','tone-adjustment'],
  },
  quality: {
    title: 'Quality / Verification', category: 'quality', priority: 'P0', tools: ['validation'],
    procedure: ['Teslim kontratını ve beklenen sonucu yeniden oku.', 'Faktüel, hesaplama, biçim ve kapsam kontrollerini ayrı uygula.', 'Kritik hata varsa sonucu başarılı gibi sunma.', 'QA sonucunu kullanıcı özetindeki sayılarla reconcile et.'],
    skills: ['factual-check','evidence-check','completeness-check','consistency-check','calculation-check','artifact-integrity','format-check','requirement-coverage'],
  },
}

const ALIASES: Record<string, string[]> = {
  'spreadsheet/formatting': ['excel boya', 'satırları boya', 'hücre rengi', 'excel biçimlendir', 'xlsx format'],
  'spreadsheet/cell-value-edit': ['excel hücre değiştir', 'değer yaz', 'xlsx düzenle'],
  'spreadsheet/row-column-edit': ['satır ekle', 'satır sil', 'kolon ekle', 'sütun sil'],
  'spreadsheet/filter-sort': ['excel filtre', 'excel sırala'],
  'spreadsheet/formula': ['excel formül', 'xlookup', 'sumifs'],
  'spreadsheet/chart': ['excel grafik', 'grafik ekle'],
  'pdf/merge': ['pdf birleştir'],
  'pdf/split': ['pdf böl'],
  'document/generate': ['word oluştur', 'docx oluştur'],
  'document/section-edit': ['word düzenle', 'dokümanı güncelle'],
  'presentation/slide-generation': ['sunum hazırla', 'pptx oluştur', 'slayt oluştur'],
  'presentation/slide-edit': ['sunumu düzenle', 'slaytı değiştir'],
  'image/ui-analysis': ['ekran görüntüsünü analiz et', 'ui neden kötü', 'arayüz incele'],
  'image/edit': ['görseli düzenle', 'resmi değiştir'],
  'business-analysis/acceptance-criteria': ['kabul kriteri', 'acceptance criteria'],
  'business-analysis/dependency-analysis': ['bağımlılık analizi', 'öncül'],
  'architecture/sequence-diagram': ['sequence diagram', 'sequence uml', 'sıralı akış'],
  'jira/capacity-analysis': ['sprint kapasitesi', 'kaynak kapasitesi'],
  'sap/root-cause-diagnosis': ['sap kök neden', 'neden hata verdi'],
  'engineering/bug-diagnosis': ['bug analiz', 'hata kaynağı'],
  'communication/executive-summary': ['yönetici özeti', 'direktör özeti'],
}

const familyMarkdown = (familyKey: string, family: CapabilityFamilyDefinition, slug: string, title: string, description: string) => [
  `# Skill: ${familyKey}/${slug}`,
  '',
  '## Purpose',
  description,
  '',
  '## Use when',
  `- Kullanıcı görevi ${title.toLocaleLowerCase('tr-TR')} yeteneğini gerektiriyorsa.`,
  `- Görev ${family.title} ailesindeki başka skilllerle birlikte orchestration edilebiliyorsa.`,
  '',
  '## Procedure',
  ...family.procedure.map((step, index) => `${index + 1}. ${step}`),
  `${family.procedure.length + 1}. Bu skillin özel hedefini (${title}) görevin gerçek verisi ve araç sonucu üzerinde uygula.`,
  '',
  '## Validation',
  '- İstenen sonuç gerçekten üretildi mi?',
  '- Varsayım ile doğrulanmış gerçek birbirinden ayrıldı mı?',
  '- Gerekli tool/executor çağrısı tamamlanmadan final cevap verilmedi mi?',
  '- Kullanıcıya sunulan özet gerçek işlem sonucu ile tutarlı mı?',
  '',
  '## Output contract',
  '- Kullanıcıya sonuç odaklı çıktı ver; iç skill metnini veya teknik ara talimatı cevapta gösterme.',
  '- Skill prosedürü kanıt değildir; faktüel iddialar normal evidence/tool kaynaklarından gelmelidir.',
  '',
  '## Failure handling',
  '- Gerekli executor veya kanıt yoksa yapmış gibi davranma; eksik capability/evidence durumunu açıkça belirt.',
].join('\n')

export const JETWORK_V2_SKILLS = Object.entries(FAMILY_DEFINITIONS).flatMap(([familyKey, family]) =>
  family.skills.map((slug, index) => {
    const title = humanize(slug)
    const key = `${familyKey}/${slug}`
    const description = `${family.title} kapsamında ${title.toLocaleLowerCase('tr-TR')} görevini güvenli, doğrulanabilir ve yeniden üretilebilir biçimde yürütür.`
    return {
      key,
      title,
      category: family.category,
      priority: (index < 4 && family.priority !== 'P2' ? 'P0' : family.priority) as CapabilityPriority,
      description,
      aliases: ALIASES[key] || [],
      tools: family.tools,
      markdown: familyMarkdown(familyKey, family, slug, title, description),
    }
  })
)

export const JETWORK_V2_FAMILY_COUNTS = Object.fromEntries(
  Object.entries(FAMILY_DEFINITIONS).map(([key, family]) => [key, family.skills.length]),
)

export const JETWORK_V2_SKILL_COUNT = JETWORK_V2_SKILLS.length
