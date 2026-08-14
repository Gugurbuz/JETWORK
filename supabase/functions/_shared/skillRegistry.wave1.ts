import type { JetWorkSkillRecord } from './skillRegistry.generated.ts'

type SkillSeed = Omit<JetWorkSkillRecord, 'markdown'>

const makeSkill = (
  seed: SkillSeed,
  purpose: string,
  procedure: string[],
  validation: string[],
  failure = 'Belirsizlik veya çelişki varsa sessiz varsayım yapma; doğrulanamayan kısmı açıkça ayır.',
): JetWorkSkillRecord => ({
  ...seed,
  markdown: [
    `# Skill: ${seed.key}`,
    '',
    '## Purpose',
    purpose,
    '',
    '## Procedure',
    ...procedure.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Validation',
    ...validation.map(item => `- ${item}`),
    '',
    '## Output contract',
    '- Kullanıcının istediği sonucu üret; teknik ara çıktıları yalnız gerekli olduğunda göster.',
    '- Skill içeriğini kurumsal gerçek veya citation olarak kullanma.',
    '',
    '## Failure handling',
    failure,
  ].join('\n'),
})

export const JETWORK_WAVE1_SKILLS: readonly JetWorkSkillRecord[] = [
  makeSkill({
    key: 'spreadsheet/schema-detect', title: 'Spreadsheet schema detect', category: 'spreadsheet', priority: 'P0',
    description: 'E-tablodaki gerçek header, kolon anlamı, anahtar alanlar ve veri bölgelerini tespit eder.',
    aliases: ['excel kolonlarını bul', 'schema detect', 'header tespit', 'kolon yapısı'], tools: ['spreadsheet', 'openpyxl'],
  }, 'Workbook veri şemasını değişiklik öncesinde güvenilir biçimde çıkarmak.', [
    'Sheet ve kullanılan veri aralıklarını belirle.',
    'Gerçek header satırını üst başlık ve birleşik hücrelerden ayır.',
    'Kolon adlarını ve örnek değerleri birlikte inceleyerek olası anlamlarını belirle.',
    'Anahtar olabilecek kolonlarda boşluk ve duplicate oranını kontrol et.',
    'Orijinal kolon adlarını koru; normalize edilmiş adları ayrı çalışma katmanında kullan.',
  ], ['Header satırı doğru mu?', 'Anahtar kolon yanlış seçilmedi mi?', 'Birleşik hücreler veri olarak yorumlanmadı mı?']),

  makeSkill({
    key: 'spreadsheet/data-cleaning', title: 'Spreadsheet data cleaning', category: 'spreadsheet', priority: 'P0',
    description: 'E-tablo verisini join, analiz veya raporlama öncesi kontrollü biçimde temizler.',
    aliases: ['excel temizle', 'data cleaning', 'boşluk temizle', 'veri normalize'], tools: ['spreadsheet', 'openpyxl', 'python'],
  }, 'Analiz sonucunu değiştirmeden veri kalitesini iyileştirmek.', [
    'Trim, görünmeyen karakter ve satır sonu problemlerini tespit et.',
    'Metin, sayı ve tarih tiplerini orijinal değeri kaybetmeden normalize et.',
    'Boş, null-benzeri ve placeholder değerleri birbirinden ayır.',
    'Temizliğin join key veya kod alanını bozmadığını doğrula.',
    'Dönüşüm sayısını ve etkilediği kolonları izlenebilir tut.',
  ], ['Satır sayısı beklenmedik değişti mi?', 'Kodların leading zero değerleri korundu mu?', 'Tarih ve sayılar yanlış parse edilmedi mi?']),

  makeSkill({
    key: 'spreadsheet/fuzzy-match', title: 'Spreadsheet fuzzy match', category: 'spreadsheet', priority: 'P1',
    description: 'Exact anahtar bulunmadığında kontrollü benzerlik eşleştirmesi yapar ve güven skorunu görünür tutar.',
    aliases: ['excel fuzzy match', 'yakın eşleşme', 'isim eşleştir', 'benzer kayıt'], tools: ['spreadsheet', 'python'],
  }, 'Güvenilir exact key olmayan tablolarda aday eşleşmeleri kontrollü üretmek.', [
    'Önce exact ve normalize exact eşleşmeleri tüket.',
    'Fuzzy eşleşmeye yalnız kalan kayıtlar için geç.',
    'Karşılaştırma alanlarını görev bağlamına göre seç ve gereksiz alanları skora katma.',
    'Her aday için skor ve ikinci en iyi aday farkını hesapla.',
    'Düşük güvenli veya birbirine çok yakın adayları otomatik kabul etme.',
  ], ['Exact eşleşmeler fuzzy ile ezilmedi mi?', 'Ambiguous kayıtlar ayrı tutuldu mu?', 'Threshold deterministik mi?']),

  makeSkill({
    key: 'spreadsheet/deduplicate', title: 'Spreadsheet deduplicate', category: 'spreadsheet', priority: 'P0',
    description: 'Duplicate kayıtları anahtar ve iş kuralına göre tespit eder, deterministik kazanan seçer.',
    aliases: ['excel duplicate sil', 'tekilleştir', 'deduplicate', 'mükerrer kayıt'], tools: ['spreadsheet', 'openpyxl', 'python'],
  }, 'Mükerrer kayıtları veri kaybı yaratmadan yönetmek.', [
    'Duplicate tanımını kolon veya kolon seti olarak belirle.',
    'Tam duplicate ile çelişkili duplicate kayıtları ayır.',
    'Kazanan kuralını tarih, durum, completeness veya kullanıcı kuralına göre deterministik kur.',
    'Silme gerekiyorsa önce kaybeden kayıtları raporlanabilir biçimde işaretle.',
    'Tekilleştirme sonrası referans ve join bütünlüğünü kontrol et.',
  ], ['Kazanan seçim kuralı açıklanabilir mi?', 'Çelişkili duplicate sessizce atılmadı mı?', 'Satır sayısı beklenen kadar azaldı mı?']),

  makeSkill({
    key: 'spreadsheet/formula', title: 'Spreadsheet formula generation', category: 'spreadsheet', priority: 'P1',
    description: 'Excel formüllerini mevcut workbook yapısına uygun ve kopyalanabilir biçimde üretir.',
    aliases: ['excel formül', 'formula', 'xlookup', 'sumifs', 'hesaplama kolonu'], tools: ['spreadsheet', 'openpyxl'],
  }, 'İstenen hesaplamayı statik değer yerine güvenilir Excel formülüyle uygulamak.', [
    'Formülün iş kuralını ve referans kolonlarını doğrula.',
    'Locale bağımlı sözdizimi yerine dosya formatının beklediği formül biçimini kullan.',
    'Relative ve absolute referansları bilinçli seç.',
    'Formülü veri aralığı boyunca uygularken boş satır ve tablo sınırını dikkate al.',
    'Mevcut formülleri overwrite etmeden önce kullanıcı niyetini doğrula.',
  ], ['Formül referansları doğru mu?', 'İlk ve son veri satırında sonuç mantıklı mı?', 'Formül hücreleri metne dönüşmedi mi?']),

  makeSkill({
    key: 'spreadsheet/pivot', title: 'Spreadsheet pivot analysis', category: 'spreadsheet', priority: 'P1',
    description: 'Tablo verisini iş sorusuna göre gruplayıp pivot/özet analiz üretir.',
    aliases: ['pivot', 'özet tablo', 'excel kırılım', 'gruplama'], tools: ['spreadsheet', 'python', 'artifact_tool'],
  }, 'Kategorik ve sayısal verileri karar vermeyi kolaylaştıran özetlere dönüştürmek.', [
    'Sorunun hangi boyut ve ölçüleri gerektirdiğini belirle.',
    'Count, distinct count, sum, average gibi aggregation türünü doğru seç.',
    'Null ve bilinmeyen kategorileri açık biçimde yönet.',
    'Toplamların kaynak veriyle reconciliation kontrolünü yap.',
    'Gerekirse yüzdesel pay ve sıralama üret.',
  ], ['Toplamlar kaynakla tutarlı mı?', 'Distinct count ile count karışmadı mı?', 'Boş kategoriler görünür mü?']),

  makeSkill({
    key: 'spreadsheet/chart', title: 'Spreadsheet chart generation', category: 'spreadsheet', priority: 'P1',
    description: 'Excel verisi için amaca uygun grafik türü, veri aralığı ve etiketleme oluşturur.',
    aliases: ['excel grafik', 'chart', 'grafik ekle', 'visualization'], tools: ['spreadsheet', 'openpyxl', 'artifact_tool'],
  }, 'Tablodaki ana mesajı yanlış yönlendirmeden görsel olarak anlatmak.', [
    'Grafiğin cevaplaması gereken soruyu belirle.',
    'Karşılaştırma, trend, dağılım veya kompozisyona göre grafik türünü seç.',
    'Kaynak aralığını header ve total satırları dahil etmeden doğrula.',
    'Başlık, eksen ve legend etiketlerini anlaşılır yap.',
    'Grafiğin workbook içindeki yerleşimini mevcut içerikle çakışmayacak şekilde ayarla.',
  ], ['Grafik veri aralığı doğru mu?', 'Eksen ölçeği yanıltıcı mı?', 'Grafik başlığı gerçek mesajı yansıtıyor mu?']),

  makeSkill({
    key: 'spreadsheet/change-report', title: 'Spreadsheet change report', category: 'spreadsheet', priority: 'P1',
    description: 'Bir Excel güncellemesinde hangi kayıt ve alanların değiştiğini özetler.',
    aliases: ['excel değişiklik raporu', 'change log', 'ne değişti', 'before after excel'], tools: ['spreadsheet', 'python'],
  }, 'Workbook değişikliğini teslim sırasında izlenebilir hale getirmek.', [
    'Değişiklik öncesi ve sonrası anahtar alanları karşılaştır.',
    'Eklenen, güncellenen, silinen ve eşleşmeyen kayıtları ayrı say.',
    'Yalnız kullanıcı için anlamlı alan değişikliklerini raporla.',
    'Format değişikliklerini veri değişikliklerinden ayır.',
    'Özet rakamları workbook QA sonucu ile reconcile et.',
  ], ['Değişiklik sayıları dosyayla aynı mı?', 'Gereksiz hücre farkları rapora girmedi mi?', 'Silinen kayıtlar görünür mü?']),

  makeSkill({
    key: 'jira/issue-match', title: 'Jira issue match', category: 'jira', priority: 'P0',
    description: 'Jira issue key/JIRA No değerlerini başka veri setlerindeki kayıtlarla güvenli biçimde eşleştirir.',
    aliases: ['jira no eşleştir', 'issue key match', 'jira mapping'], tools: ['spreadsheet', 'jira'],
  }, 'Jira kayıtlarını dış tablo veya backlog listesiyle güvenilir anahtar üzerinden bağlamak.', [
    'Issue key formatını normalize et ama orijinal değeri koru.',
    'Exact key eşleşmesini birincil yöntem olarak kullan.',
    'Duplicate issue key veya birden fazla hedef satır varsa ayrı raporla.',
    'Key bulunmayan kayıtlar için otomatik semantik eşleştirmeye geçme.',
    'Mapping sonucunu matched/unmatched/duplicate olarak say.',
  ], ['Issue key yanlış kolonla eşleşmedi mi?', 'Duplicate key görünür mü?', 'Unmatched kayıtlar kaybolmadı mı?']),

  makeSkill({
    key: 'jira/status-normalize', title: 'Jira status normalize', category: 'jira', priority: 'P0',
    description: 'Jira status değerlerini raporlama ve iş kuralı için kontrollü üst kategorilere normalize eder.',
    aliases: ['jira status', 'done closed', 'statü normalize', 'status mapping'], tools: ['jira', 'spreadsheet'],
  }, 'Farklı Jira status adlarını anlam kaybı olmadan ortak raporlama kategorisine çevirmek.', [
    'Orijinal status değerini değişmeden sakla.',
    'Done/Closed/Resolved gibi tamamlanma statuslarını kurum kuralına göre completion grubuna map et.',
    'In Progress, To Do ve blocked benzeri durumları ayrı tut.',
    'Bilinmeyen statusu zorla bilinen kategoriye sokma.',
    'Mapping tablosunu deterministik ve tekrar kullanılabilir tut.',
  ], ['Orijinal status korunuyor mu?', 'Tamamlanmış kayıtlar doğru sınıfta mı?', 'Unknown status açıkça ayrıldı mı?']),

  makeSkill({
    key: 'jira/sprint-extract', title: 'Jira sprint extract', category: 'jira', priority: 'P0',
    description: 'Jira sprint alanındaki bir veya çoklu sprint bilgisini yapılandırılmış biçimde ayrıştırır.',
    aliases: ['sprint ayrıştır', 'jira sprint parse', 'sprint extract'], tools: ['jira', 'spreadsheet', 'python'],
  }, 'Jira exportundaki karmaşık sprint hücrelerinden güvenilir sprint kayıtları üretmek.', [
    'Sprint alanının ham formatını örneklerden tespit et.',
    'Bir hücredeki tüm sprint adaylarını ayrı kayıtlara parse et.',
    'Sprint adı, numarası, state ve tarih gibi alanları varsa ayrı tut.',
    'EN-Fast gibi naming patternlerini açık kuralla ayır.',
    'Parse edilemeyen parçayı sessizce atma.',
  ], ['Tüm sprint adayları yakalandı mı?', 'Yıl veya başka sayılar sprint numarası sanılmadı mı?', 'Parse hataları görünür mü?']),

  makeSkill({
    key: 'jira/aging', title: 'Jira aging analysis', category: 'jira', priority: 'P1',
    description: 'Jira işlerinin yaşını oluşturma, güncelleme, sprint veya statü tarihine göre analiz eder.',
    aliases: ['jira aging', 'iş yaşı', 'kaç gündür açık', 'backlog age'], tools: ['jira', 'spreadsheet', 'python'],
  }, 'Bekleyen veya uzun süren Jira işlerini doğru zaman referansıyla görünür kılmak.', [
    'Aging başlangıç tarihini iş sorusuna göre seç: created, status change veya sprint entry.',
    'Tamamlanan işlerde bitiş tarihini bugünün tarihi yerine completion tarihi yap.',
    'Takvim günü ve iş günü ayrımını açık tut.',
    'Yaş grupları gerekiyorsa anlamlı bucketlar oluştur.',
    'Aykırı eski kayıtları veri hatası ihtimali açısından kontrol et.',
  ], ['Başlangıç tarihi doğru mu?', 'Kapalı işlerde aging artmaya devam etmiyor mu?', 'Timezone farkı sonucu bozuyor mu?']),

  makeSkill({
    key: 'jira/comment-analysis', title: 'Jira comment analysis', category: 'jira', priority: 'P1',
    description: 'Jira yorumlarından karar, blocker, aksiyon, bağımlılık ve son durum sinyallerini çıkarır.',
    aliases: ['jira yorum analizi', 'comment analysis', 'blocker yorum', 'aksiyon çıkar'], tools: ['jira', 'text-analysis'],
  }, 'Jira yorum geçmişini özetlemek yerine karar ve aksiyon sinyallerine dönüştürmek.', [
    'Yorumları kronolojik sırada incele.',
    'Karar, soru, blocker, dependency ve aksiyon ifadelerini ayrı etiketle.',
    'Eski yorumla sonraki yorum çelişiyorsa en güncel kararı önceliklendir ama değişimi göster.',
    'Kişi görüşünü sistem gerçeği gibi sunma.',
    'Açık aksiyonların sahibini ve tarihini yalnız yorumda varsa çıkar.',
  ], ['Son karar eski yorumla karışmadı mı?', 'Varsayımsal ifadeler karar sayılmadı mı?', 'Aksiyon sahibi uydurulmadı mı?']),

  makeSkill({
    key: 'jira/backlog-quality', title: 'Jira backlog quality', category: 'jira', priority: 'P1',
    description: 'Backlog maddelerini açıklık, kapsam, kabul kriteri, bağımlılık ve uygulanabilirlik açısından değerlendirir.',
    aliases: ['backlog kalite', 'jira story kalite', 'refinement readiness'], tools: ['jira', 'business-analysis'],
  }, 'Refinement öncesi backlog maddelerinin gerçekten geliştirilebilir olup olmadığını ölçmek.', [
    'Amaç, kapsam, aktör, davranış ve beklenen sonucu kontrol et.',
    'Acceptance criteria veya doğrulanabilir başarı koşullarını ara.',
    'Bağımlılık, veri, entegrasyon ve yetki açıklarını tespit et.',
    'Story ile ilgisiz şablon sorularını kalite açığı olarak sayma.',
    'Eksikleri önem ve geliştirmeyi bloklama etkisine göre sınıflandır.',
  ], ['Açık soru gerçek bir karar açığı mı?', 'Kaynakta cevabı olan konu yeniden sorulmadı mı?', 'Bloker ile nice-to-have ayrıldı mı?']),

  makeSkill({
    key: 'jira/sprint-analysis', title: 'Jira sprint analysis', category: 'jira', priority: 'P1',
    description: 'Sprint kapsamı, tamamlanma, carry-over, kapasite ve iş tipi dağılımını analiz eder.',
    aliases: ['sprint analiz', 'carry over', 'sprint performans', 'tamamlanma oranı'], tools: ['jira', 'spreadsheet', 'python'],
  }, 'Sprint performansını yalnız toplam adet değil kapsam ve akış kalitesiyle değerlendirmek.', [
    'Sprintte committed ve sonradan eklenen işleri mümkünse ayır.',
    'Done ve carry-over kayıtlarını normalize edilmiş status ile belirle.',
    'Efor varsa adet ve efor bazlı tamamlanmayı ayrı hesapla.',
    'İş tipi, ekip veya epic kırılımlarını ihtiyaca göre üret.',
    'Sprint değişikliklerinin plan güvenilirliğine etkisini belirt.',
  ], ['Done tanımı tutarlı mı?', 'Sprint dışı işler dahil edilmedi mi?', 'Efor ve adet metrikleri karıştırılmadı mı?']),

  makeSkill({
    key: 'jira/effort-analysis', title: 'Jira effort analysis', category: 'jira', priority: 'P1',
    description: 'Jira original estimate/remaining/logged veya özel efor alanlarını iş tipi ve ekip bazında analiz eder.',
    aliases: ['jira efor', 'original estimate', 'effort analysis', 'efor kırılım'], tools: ['jira', 'spreadsheet', 'python'],
  }, 'Backlog veya sprint eforunu doğru alan ve birim üzerinden karşılaştırmak.', [
    'Kullanılan efor alanını ve birimini açıkça belirle.',
    'Saat, gün ve story point değerlerini aynı toplamda karıştırma.',
    'Eksik eforlu kayıtları sıfır kabul etmek yerine ayrı say.',
    'İş tipi, ekip, epic veya dönem kırılımlarını kullanıcı amacına göre üret.',
    'Ortalama ve toplam metriklerde outlier etkisini kontrol et.',
  ], ['Birimler normalize edildi mi?', 'Eksik eforlar görünür mü?', 'Toplamlar alt kırılımlarla reconcile oluyor mu?']),

  makeSkill({
    key: 'business-analysis/requirement-understanding', title: 'Requirement understanding', category: 'business-analysis', priority: 'P0',
    description: 'Talebin gerçek amacını, aktörünü, tetikleyicisini, çıktısını ve sınırlarını çözümler.',
    aliases: ['gereksinimi anla', 'talep analizi', 'requirement understanding'], tools: ['knowledge', 'documents'],
  }, 'Kullanıcının söylediği çözümden önce gerçek iş ihtiyacını anlamak.', [
    'Talebin hedefini ve hangi problemi çözdüğünü çıkar.',
    'Aktör, tetikleyici, girdiler, beklenen davranış ve çıktıyı belirle.',
    'Kesin bilgi, varsayım ve açık noktayı birbirinden ayır.',
    'Kurum özelindeki ayrıntılar gerekiyorsa knowledge kanıtı kullan.',
    'Gereksiz clarification yerine mevcut bağlamdan çözülebilen kısmı tamamla.',
  ], ['Amaç ile çözüm karıştırıldı mı?', 'Varsayım gerçek gibi yazıldı mı?', 'Kapsam dışı konu eklendi mi?']),

  makeSkill({
    key: 'business-analysis/requirement-decomposition', title: 'Requirement decomposition', category: 'business-analysis', priority: 'P0',
    description: 'Büyük bir talebi bağımsız iş kuralları, fonksiyonel gereksinimler ve alt akışlara böler.',
    aliases: ['gereksinim parçala', 'FR çıkar', 'requirement decomposition'], tools: ['business-analysis', 'documents'],
  }, 'Karmaşık talebi izlenebilir ve test edilebilir atomik parçalara ayırmak.', [
    'Ana iş sonucunu koruyarak fonksiyonel davranışları ayır.',
    'Her gereksinimi tek ana davranış veya kural etrafında yaz.',
    'UI, entegrasyon, veri ve batch ihtiyaçlarını gerektiğinde ayrılaştır.',
    'Aynı kuralın tekrarlarını tekilleştir.',
    'Her alt gereksinimin kaynağa veya üst talebe izini koru.',
  ], ['FRler birbirini tekrar ediyor mu?', 'Her FR test edilebilir mi?', 'Kaynakta olmayan detay eklenmiş mi?']),

  makeSkill({
    key: 'business-analysis/business-rule-extraction', title: 'Business rule extraction', category: 'business-analysis', priority: 'P0',
    description: 'Doküman ve açıklamalardan koşul, karar, istisna, hesap ve engel kurallarını çıkarır.',
    aliases: ['iş kuralı çıkar', 'business rule', 'kural analizi'], tools: ['knowledge', 'documents'],
  }, 'Dağınık anlatımdaki gerçek karar mantığını açık iş kurallarına dönüştürmek.', [
    'Koşul, karar ve sonucu birlikte yakala.',
    'İstisna ve öncelik kurallarını ana kuraldan ayır.',
    'Aynı kuralın farklı cümlelerdeki tekrarlarını birleştir.',
    'Kaynakta olmayan threshold veya status uydurma.',
    'Çelişen kuralları kaynaklarıyla birlikte işaretle.',
  ], ['Kural koşulsuz genellenmedi mi?', 'İstisnalar kaybolmadı mı?', 'Kaynak dışı değer eklenmedi mi?']),

  makeSkill({
    key: 'business-analysis/acceptance-criteria', title: 'Acceptance criteria generation', category: 'business-analysis', priority: 'P0',
    description: 'Gereksinimleri doğrulanabilir ve iş sonucuna odaklı kabul kriterlerine dönüştürür.',
    aliases: ['kabul kriteri', 'acceptance criteria', 'AC yaz'], tools: ['business-analysis'],
  }, 'Geliştirilen davranışın başarı koşullarını açık ve test edilebilir hale getirmek.', [
    'Her kriteri tek doğrulanabilir davranış veya sonuç etrafında yaz.',
    'Pozitif, negatif ve kritik istisna yollarını kapsa.',
    'UI implementasyon detayını iş sonucu yerine koyma.',
    'Kaynakta olmayan değer ve mesajları uydurma.',
    'Kullanıcı Given/When/Then istemiyorsa doğal cümle formatı kullan.',
  ], ['Her kriter test edilebilir mi?', 'Aynı kural tekrarlandı mı?', 'Beklenen sonuç açık mı?']),

  makeSkill({
    key: 'business-analysis/as-is', title: 'As-is analysis', category: 'business-analysis', priority: 'P1',
    description: 'Mevcut iş sürecini aktör, sistem, veri ve karar adımlarıyla dokümante eder.',
    aliases: ['mevcut durum', 'as is', 'bugünkü süreç'], tools: ['knowledge', 'documents', 'business-analysis'],
  }, 'Mevcut süreci yorum eklemeden, kanıtlanan davranışlarıyla görünür hale getirmek.', [
    'Başlangıç tetikleyicisini ve aktörleri belirle.',
    'Süreç adımlarını gerçekleşme sırasıyla çıkar.',
    'Sistemler arası veri ve entegrasyon geçişlerini ayır.',
    'Karar noktaları ve istisnaları göster.',
    'Bilinmeyen mevcut davranışı varsayımla doldurma.',
  ], ['Akış sırası kaynakla tutarlı mı?', 'To-be davranışı as-is içine karıştı mı?', 'Açık noktalar görünür mü?']),

  makeSkill({
    key: 'business-analysis/to-be', title: 'To-be design', category: 'business-analysis', priority: 'P1',
    description: 'Hedef süreci gereksinim, kısıt ve mevcut sistem gerçeklerine göre tasarlar.',
    aliases: ['hedef süreç', 'to be', 'gelecek durum'], tools: ['business-analysis', 'knowledge'],
  }, 'İş hedefini karşılayan uygulanabilir hedef süreç tasarlamak.', [
    'Hedef sonucu ve başarı kriterini netleştir.',
    'As-is kısıtlarını ve korunacak davranışları dikkate al.',
    'Yeni adım, otomasyon, karar ve entegrasyonları açıkça ayır.',
    'Alternatif çözüm gerekiyorsa etkileriyle karşılaştır.',
    'Tasarım varsayımlarını doğrulanmış mevcut gerçeklerden ayır.',
  ], ['Hedef süreç gereksinimi karşılıyor mu?', 'Yeni bağımlılıklar görünür mü?', 'As-is ile to-be farkı açık mı?']),

  makeSkill({
    key: 'business-analysis/impact-analysis', title: 'Impact analysis', category: 'business-analysis', priority: 'P0',
    description: 'Bir değişikliğin süreç, sistem, veri, entegrasyon, kullanıcı ve operasyon etkilerini çıkarır.',
    aliases: ['etki analizi', 'impact analysis', 'nereleri etkiler'], tools: ['knowledge', 'business-analysis'],
  }, 'Değişikliğin doğrudan ve dolaylı etkilerini kanıta dayalı belirlemek.', [
    'Değişen iş kuralı veya veri nesnesini başlangıç noktası yap.',
    'Çağıran/çağrılan süreç ve sistemleri ilişki kanıtlarıyla izle.',
    'UI, backend, entegrasyon, veri, rapor ve operasyon etkilerini ayrı değerlendir.',
    'Doğrudan kanıt ile mantıksal çıkarımı etiketle.',
    'Regresyon riski olan mevcut akışları görünür kıl.',
  ], ['Etki zinciri kanıtlı mı?', 'Varsayımsal sistemler gerçek gibi yazıldı mı?', 'Dolaylı riskler ayrıldı mı?']),

  makeSkill({
    key: 'business-analysis/dependency-analysis', title: 'Dependency analysis', category: 'business-analysis', priority: 'P0',
    description: 'İş maddeleri arasındaki öncül, veri, servis, ekip ve teslim bağımlılıklarını belirler.',
    aliases: ['bağımlılık analizi', 'dependency', 'öncül', 'birbirini bekleyen işler'], tools: ['jira', 'knowledge', 'business-analysis'],
  }, 'Plan sırasını gerçek teknik ve iş bağımlılıklarına göre kurmak.', [
    'Her işin ürettiği ve tükettiği çıktıları belirle.',
    'Hard dependency ile yalnız koordinasyon ihtiyacını ayır.',
    'Servis/backend/frontend ve kaynak sistem zincirlerini sırala.',
    'Explicit öncül alanlarını içerik tabanlı bağımlılıklarla birlikte değerlendir.',
    'Döngüsel veya çelişkili bağımlılıkları işaretle.',
  ], ['Hard dependency gerekçeli mi?', 'Efor yakınlığı bağımlılık sanılmadı mı?', 'Sıralama bağımlılık yönüyle uyumlu mu?']),

  makeSkill({
    key: 'business-analysis/process-analysis', title: 'Process analysis', category: 'business-analysis', priority: 'P1',
    description: 'Bir iş sürecini tetikleyici, adım, karar, rol, sistem ve sonuç seviyesinde analiz eder.',
    aliases: ['süreç analizi', 'process analysis', 'akış analizi'], tools: ['business-analysis', 'knowledge'],
  }, 'İş sürecinin nasıl çalıştığını ve sorun/iyileştirme noktalarını sistematik görmek.', [
    'Süreç sınırını ve başlangıç/bitiş olayını belirle.',
    'Aktör ve sistem sorumluluklarını ayır.',
    'Adım, karar, bekleme ve exception yollarını çıkar.',
    'El değiştirme ve manuel işlem noktalarını görünür kıl.',
    'Sorunları kanıtlanan süreç davranışından ayrı yorumla.',
  ], ['Akışta atlanan karar var mı?', 'Rol ve sistem görevleri karıştı mı?', 'Exception yolu kapsandı mı?']),

  makeSkill({
    key: 'business-analysis/technical-analysis', title: 'Technical analysis', category: 'business-analysis', priority: 'P1',
    description: 'Fonksiyonel talebi sistem bileşenleri, veri, servis, kural ve hata davranışları açısından teknik analize dönüştürür.',
    aliases: ['teknik analiz', 'technical analysis', 'sistem analizi'], tools: ['knowledge', 'repository', 'business-analysis'],
  }, 'İş ihtiyacını uygulanabilir teknik değişiklik alanlarına çevirmek.', [
    'Fonksiyonel davranışları teknik sorumluluk alanlarına map et.',
    'Mevcut nesne, servis ve veri ilişkilerini yalnız doğrulanmış kaynakla belirt.',
    'Yeni/etkilenen API, tablo, batch, UI veya entegrasyon ihtiyacını ayır.',
    'Hata, retry, transaction ve observability davranışlarını gerektiğinde değerlendir.',
    'Kesin teknik identifier kanıtta yoksa uydurma.',
  ], ['Teknik nesneler kaynakla doğrulandı mı?', 'Fonksiyonel kural teknik detay arasında kayboldu mu?', 'Belirsizlik açık mı?']),

  makeSkill({
    key: 'sap/object-recognition', title: 'SAP object recognition', category: 'sap', priority: 'P0',
    description: 'SAP class, method, function, table, message, program ve servis identifierlarını tanır ve doğru nesne tipine ayırır.',
    aliases: ['sap nesne tanı', 'class method table', 'sap object'], tools: ['knowledge'],
  }, 'Teknik sorudaki SAP identifierlarının ne tür nesne olduğunu yanlış varsaymadan belirlemek.', [
    'Identifierı biçiminden aday nesne tiplerine ayır.',
    'Kurumsal catalog/knowledge içinde exact kayıt ara.',
    'Aynı ada benzeyen farklı nesne tiplerini ayır.',
    'Doğrulanan canonical key ve object type bilgisini kullan.',
    'Bulunmayan identifierın davranışını tahmin etme.',
  ], ['Exact kayıt var mı?', 'Nesne tipi doğrulandı mı?', 'Benzer isimli farklı nesneyle karışmadı mı?']),

  makeSkill({
    key: 'sap/method-analysis', title: 'SAP method analysis', category: 'sap', priority: 'P0',
    description: 'SAP/ABAP methodunun girişlerini, kontrollerini, çağrılarını, veri erişimini ve çıktısını doğrulanmış kaynak üzerinden analiz eder.',
    aliases: ['abap method analiz', 'sap metod', 'method analysis'], tools: ['knowledge', 'code-analysis'],
  }, 'Bir SAP metodunun gerçekten ne yaptığını source ve ilişkili nesneler üzerinden açıklamak.', [
    'Metodun exact source kaydını doğrula.',
    'Ana branch, kontrol, çağrı ve veri erişimlerini çıkar.',
    'Mesaj/exception üretim noktalarını ayrı tespit et.',
    'Çağrılan nesneler için gerekli olduğunda ilişki kanıtı topla.',
    'Source dışında davranış veya mesaj uydurma.',
  ], ['Metod source doğrulandı mı?', 'Call chain ile doğrudan kod davranışı ayrıldı mı?', 'Mesaj metni kanıtlı mı?']),

  makeSkill({
    key: 'sap/message-analysis', title: 'SAP message analysis', category: 'sap', priority: 'P0',
    description: 'SAP mesaj kodu, metni, severity ve hangi koşulda üretildiğini kanıt üzerinden analiz eder.',
    aliases: ['sap mesaj', 'message analysis', 'zcrm2 hata', 'mesaj kodu'], tools: ['knowledge'],
  }, 'SAP hata/uyarı mesajlarının kodunu ve üretim koşulunu halüsinasyonsuz açıklamak.', [
    'Mesaj class + number kombinasyonunu exact doğrula.',
    'Mesaj metnini kaynakta bulunduğu haliyle eşleştir.',
    'Severity veya message type bilgisini yalnız kanıt varsa belirt.',
    'Mesajı üreten method/source noktasını ilişki kanıtıyla bul.',
    'Benzer numaralı mesajları birbirine karıştırma.',
  ], ['Kod ve metin aynı kaynaktan doğrulandı mı?', 'Koşul source ile destekli mi?', 'Eksik severity uydurulmadı mı?']),

  makeSkill({
    key: 'sap/table-relationship', title: 'SAP table relationship', category: 'sap', priority: 'P1',
    description: 'SAP tabloları arasındaki anahtar, foreign-key-benzeri ve uygulama akışındaki ilişkileri analiz eder.',
    aliases: ['sap tablo ilişkisi', 'table relationship', 'join hangi alan'], tools: ['knowledge', 'data-analysis'],
  }, 'SAP veri modelinde tabloların nasıl bağlandığını gerçek alan ve kullanım kanıtıyla açıklamak.', [
    'İlgili tabloların exact kayıtlarını doğrula.',
    'Ortak alan ve key adaylarını kaynaklardan çıkar.',
    'Teknik DDIC ilişkisi ile uygulama kodundaki join kullanımını ayır.',
    'Cardinality veya zorunluluk bilgisini yalnız kanıt varsa belirt.',
    'İlişkiyi örnek veri üzerinden genelleme.',
  ], ['Alan adları doğrulandı mı?', 'Join yönü doğru mu?', 'Varsayılan cardinality uydurulmadı mı?']),

  makeSkill({
    key: 'sap/data-flow-analysis', title: 'SAP data flow analysis', category: 'sap', priority: 'P1',
    description: 'SAP süreçlerinde verinin kaynak sistemden hedef nesneye hangi adımlarla taşındığını analiz eder.',
    aliases: ['sap veri akışı', 'data flow', 'hangi sistemden geliyor'], tools: ['knowledge', 'integration-analysis'],
  }, 'Bir alan veya iş bilgisinin uçtan uca teknik akışını kanıtlanmış adımlarla çıkarmak.', [
    'Kaynak veri nesnesini ve hedef tüketiciyi belirle.',
    'Aradaki function, service, mapping, table veya method geçişlerini sırala.',
    'Her hop için veri dönüşümü veya filtre varsa belirt.',
    'Asenkron/batch ve senkron akışları ayır.',
    'Kanıtlanmayan ara hopları zincire ekleme.',
  ], ['Her hop kaynakla destekli mi?', 'Akış yönü doğru mu?', 'Alan dönüşümü varsayılmadı mı?']),

  makeSkill({
    key: 'sap/diagnosis', title: 'SAP error root cause diagnosis', category: 'sap', priority: 'P0',
    description: 'SAP hata davranışını method, mesaj, veri ve call-chain kanıtlarını birleştirerek kök neden adaylarına indirger.',
    aliases: ['sap kök neden', 'root cause', 'hata analizi', 'neden hata verdi'], tools: ['knowledge', 'code-analysis'],
  }, 'SAP teknik hatalarında doğrulanmış kanıtla en olası kök nedeni belirlemek.', [
    'Semptom, exact hata mesajı ve etkilenen işlem adımını ayır.',
    'Mesajın üretildiği source noktasını doğrula.',
    'Branch koşulları ve kullanılan veri alanlarını geriye doğru izle.',
    'Alternatif kök nedenleri kanıt gücüne göre sırala.',
    'Doğrulanmış bulgu, çıkarım ve açık soruyu ayrı sun.',
  ], ['Mesaj koşulu source ile uyumlu mu?', 'Tek kanıttan kesin kök neden çıkarılmadı mı?', 'Alternatif olasılık göz ardı edilmedi mi?']),

  makeSkill({
    key: 'engineering/repository-analysis', title: 'Repository analysis', category: 'engineering', priority: 'P1',
    description: 'Kod deposunun mimarisini, entrypointlerini, modül ilişkilerini, testlerini ve değişiklik etkisini analiz eder.',
    aliases: ['repo analiz', 'repository analysis', 'kod tabanı incele', 'github repo'], tools: ['github', 'repository'],
  }, 'Kod değişikliğinden önce repository yapısını ve gerçek etki alanını anlamak.', [
    'İlgili entrypoint ve modülleri repository içinden doğrula.',
    'Import/call ilişkilerini ve config/feature flag bağlantılarını izle.',
    'Mevcut test ve regression guardlarını belirle.',
    'Değişiklik için minimum dosya setini çıkar.',
    'Kodda bulunmayan bileşen veya davranışı varsayma.',
  ], ['Etki dosyaları gerçek import ilişkisine dayanıyor mu?', 'Test kapsamı kontrol edildi mi?', 'Main yerine doğru branch inceleniyor mu?']),

  makeSkill({
    key: 'files/file-comparison', title: 'File comparison', category: 'files', priority: 'P1',
    description: 'İki veya daha fazla dosyayı yapı, içerik, kayıt ve anlamlı değişiklik açısından karşılaştırır.',
    aliases: ['dosya karşılaştır', 'file compare', 'iki dosya farkı', 'versiyon karşılaştır'], tools: ['files', 'spreadsheet', 'documents'],
  }, 'Dosyalar arasındaki gerçek farkları format gürültüsünden ayırarak açıklamak.', [
    'Dosya tipini ve karşılaştırılabilir yapıyı belirle.',
    'Yapısal fark, içerik farkı ve format farkını ayrı değerlendir.',
    'Tablolu dosyalarda güvenilir key varsa kayıt bazlı karşılaştır.',
    'Dokümanlarda bölüm/başlık eşleştirmesi yap.',
    'Eklenen, silinen ve değişen öğeleri dengeli özetle.',
  ], ['Aynı içerik format farkı yüzünden değişmiş sayılmadı mı?', 'Silinen öğeler yakalandı mı?', 'Karşılaştırma anahtarı güvenilir mi?']),
] as const
