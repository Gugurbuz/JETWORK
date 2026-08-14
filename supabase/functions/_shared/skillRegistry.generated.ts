// GENERATED RUNTIME REGISTRY.
// Canonical source lives under /skills/**/SKILL.md. Keep skill text procedural:
// skills are trusted JetWork workflow instructions, never enterprise evidence.

import { JETWORK_WAVE1_SKILLS } from './skillRegistry.wave1.ts'

export interface JetWorkSkillRecord {
  key: string
  title: string
  category: string
  priority: 'P0' | 'P1' | 'P2'
  description: string
  aliases: string[]
  tools: string[]
  markdown: string
}

const CORE_SKILLS: readonly JetWorkSkillRecord[] = [
  {
    key: 'spreadsheet/inspect',
    title: 'Spreadsheet inspect',
    category: 'spreadsheet',
    priority: 'P0',
    description: 'Excel/XLS/XLSX/CSV dosyasının sheet, header, veri tipi, formül ve görünüm yapısını değiştirmeden önce inceler.',
    aliases: ['excel incele', 'spreadsheet read', 'xlsx inspect', 'xls analiz'],
    tools: ['spreadsheet', 'openpyxl', 'artifact_tool'],
    markdown: `# Skill: spreadsheet/inspect

## Purpose
E-tablo üzerinde işlem yapmadan önce gerçek workbook yapısını güvenli biçimde anlamak.

## Procedure
1. Workbook içindeki tüm sheet adlarını ve kullanılan aralıkları belirle.
2. Gerçek header satırını tespit et; birleşik hücre veya üst başlıkları veri başlığı sanma.
3. Örnek satırlardan veri tiplerini, boşlukları, formülleri ve tarih formatlarını kontrol et.
4. Gizli sheet, filtre, dondurulmuş panel, tablo ve önemli biçimlendirmeleri kaydet.
5. Görev için gerekli anahtar kolonları normalize etmeden önce orijinal değerleri koru.
6. Değişiklik planını workbook yapısına göre oluştur.

## Validation
- Header doğru satırdan mı alındı?
- Formüller veri gibi overwrite edilmeyecek mi?
- Tarih ve sayı biçimleri yanlış parse edilmiyor mu?

## Failure handling
Legacy XLS yapısı doğrudan düzenlenemiyorsa dönüştürme gereksinimini belirt ve orijinali koru.`,
  },
  {
    key: 'spreadsheet/table-join',
    title: 'Spreadsheet table join',
    category: 'spreadsheet',
    priority: 'P0',
    description: 'İki veya daha fazla tabloyu JIRA No, ID, kod veya başka bir anahtar üzerinden güvenli biçimde eşleştirir.',
    aliases: ['excel map', 'jira no eşleştir', 'table join', 'vlookup eşleştir', 'dosya map'],
    tools: ['spreadsheet', 'openpyxl', 'artifact_tool'],
    markdown: `# Skill: spreadsheet/table-join

## Purpose
Kaynak tablodaki alanları ortak anahtar üzerinden hedef tabloya veri kaybı ve sessiz duplicate üretmeden taşımak.

## Procedure
1. Kaynak ve hedef tabloyu açıkça belirle.
2. Join key kolonlarını iki tarafta trim, case ve görünmeyen karakterler açısından normalize et; orijinal hücreyi değiştirme.
3. Kaynak tarafta duplicate key olup olmadığını kontrol et ve hangi kaydın kazanacağını deterministik kuralla belirle.
4. Exact join uygula; eşleşen, eşleşmeyen ve duplicate kayıt sayılarını tut.
5. Yeni kolon ekleniyorsa mevcut kolon sırasını gereksiz yere bozma.
6. Kullanıcı yalnız belirli durumları işaretlemek istiyorsa join sonucunu iş kuralına göre uygula.

## Validation
- Hedef satır sayısı beklenmedik biçimde değişmedi mi?
- Bir hedef satıra birden fazla kaynak satır sessizce yazılmadı mı?
- Eşleşmeyen kayıtlar raporlandı mı?
- Join key değerleri outputta bozulmadı mı?

## Failure handling
Duplicate kaynak kayıtlar çelişiyorsa rastgele seçim yapma; deterministik kural kurulamıyorsa kullanıcıya belirt.`,
  },
  {
    key: 'spreadsheet/format-preserve',
    title: 'Spreadsheet format preserve',
    category: 'spreadsheet',
    priority: 'P0',
    description: 'Mevcut workbook tasarımını, formülleri, hücre stillerini ve kullanıcı düzenini bozmadan veri güncellemesi yapar.',
    aliases: ['excel formatı koru', 'preserve formatting', 'tasarımı bozma'],
    tools: ['spreadsheet', 'openpyxl'],
    markdown: `# Skill: spreadsheet/format-preserve

## Purpose
Mevcut Excel'i veri açısından güncellerken kurumsal görünümü ve workbook davranışını korumak.

## Procedure
1. Değiştirilecek hücre aralığını minimumda tut.
2. Yeni kolon eklerken komşu kolon stilini uygun şekilde kopyala; formül ve number formatı ayır.
3. Birleşik hücre, filtre, tablo ve freeze pane yapılarını koru.
4. Mevcut koşullu biçimlendirmeleri silme; yeni kural ekleniyorsa çakışmayı kontrol et.
5. Done/Closed gibi durum işaretlerinde kullanıcı tarafından istenen görsel vurguyu tutarlı uygula.
6. Kaydetmeden sonra workbook'un yeniden açılabildiğini doğrula.

## Validation
- Sheet adları ve sırası korunuyor mu?
- Formüller kaybolmadı mı?
- Yeni kolon mevcut tasarımla uyumlu mu?
- Workbook açıldığında bozuk dosya uyarısı oluşmuyor mu?`,
  },
  {
    key: 'spreadsheet/quality-check',
    title: 'Spreadsheet quality check',
    category: 'spreadsheet',
    priority: 'P0',
    description: 'E-tablo çıktısını teslimden önce veri, formül, eşleşme, biçim ve dosya bütünlüğü açısından kontrol eder.',
    aliases: ['excel kalite kontrol', 'spreadsheet validate', 'xlsx check'],
    tools: ['spreadsheet', 'openpyxl', 'python'],
    markdown: `# Skill: spreadsheet/quality-check

## Purpose
Spreadsheet çıktısını kullanıcıya vermeden önce veri ve dosya bütünlüğü hatalarını yakalamak.

## Procedure
1. Workbook'u üretilen dosyadan yeniden aç.
2. Beklenen sheet ve kolonların bulunduğunu doğrula.
3. Satır sayısı, join sayıları ve işaretlenen kayıtları beklenen kurallarla karşılaştır.
4. Formül hücrelerinin yanlışlıkla statik değere dönüşmediğini kontrol et.
5. Tarih, sayı, yüzde ve metin biçimlerinde anomali ara.
6. Boş veya duplicate anahtarları say.
7. Çıktı dosyasının gerçek path ve uzantısını doğrula.

## Validation
- Dosya yeniden açılabiliyor mu?
- İstenen değişikliklerin tamamı uygulanmış mı?
- Beklenmeyen veri kaybı var mı?
- Kullanıcıya verilen özet sayılar dosyayla aynı mı?

## Failure handling
Kritik QA hatası varsa dosyayı başarılıymış gibi sunma.`,
  },
  {
    key: 'jira/export-analysis',
    title: 'Jira export analysis',
    category: 'jira',
    priority: 'P0',
    description: 'Jira XLS/XLSX/CSV exportundaki key, status, sprint, epic, assignee ve tarih alanlarını doğru yorumlar.',
    aliases: ['jira excel', 'jira export', 'jira xls analiz'],
    tools: ['spreadsheet'],
    markdown: `# Skill: jira/export-analysis

## Purpose
Jira export dosyasını başka skill'lerin güvenle kullanabileceği normalize edilmiş kayıtlara dönüştürmek.

## Procedure
1. Gerçek header satırını tespit et.
2. Issue Key/JIRA No alanını benzersiz anahtar olarak doğrula.
3. Status değerlerini orijinal haliyle oku; normalize edilmiş alanı ayrı üret.
4. Sprint hücreleri birden fazla değer içeriyorsa ayrıştır ve sıra bilgisini koru.
5. Epic, parent ve issue type alanlarını karıştırma.
6. Tarih alanlarının timezone ve export formatını kontrol et.

## Validation
- Issue Key duplicate mı?
- Status ve sprint alanları kesilmeden okundu mu?
- Birden fazla sprint geçmişi tek string sanılmadı mı?`,
  },
  {
    key: 'jira/latest-sprint',
    title: 'Jira latest sprint detection',
    category: 'jira',
    priority: 'P0',
    description: 'Bir Jira kaydı birden fazla sprint taşıdıysa en son/geçerli EN-Fast sprint numarasını deterministik çıkarır.',
    aliases: ['enfast sprint', 'latest sprint', 'son sprint', 'sprint numarası'],
    tools: ['spreadsheet', 'python'],
    markdown: `# Skill: jira/latest-sprint

## Purpose
Jira exportundaki sprint geçmişinden hedef rapora yazılacak tek ve güvenilir EN-Fast sprint bilgisini üretmek.

## Procedure
1. Sprint hücresindeki tüm değerleri ayrıştır.
2. EN-Fast adlandırma patternini diğer sprintlerden ayır.
3. Numara veya sıra bilgisi varsa en yüksek/geçerli sprinti seç; sırf metinde son göründüğü için seçme, format bunu garanti etmiyorsa.
4. Kapalı ve aktif sprint ayrımı exportta bulunuyorsa aktif/en güncel bilgiyi önceliklendir.
5. Seçilen sprintin ham kaynağını gerektiğinde izlenebilir tut.
6. Sprint bulunmayan kaydı boş bırak; uydurma default yazma.

## Validation
- Birden fazla sprintli örneklerde seçim deterministik mi?
- EN-Fast dışı sprint yanlışlıkla alınmadı mı?
- Sprint numarası parse edilirken yıl veya başka sayı seçilmedi mi?

## Failure handling
Sıralama bilgisi güvenilir değilse belirsiz adayları otomatik seçme.`,
  },
]

export const JETWORK_SKILLS: readonly JetWorkSkillRecord[] = [
  ...CORE_SKILLS,
  ...JETWORK_WAVE1_SKILLS,
]
