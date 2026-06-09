import type { DocumentData } from '../types';

export const CONCEPTUAL_TEMPLATE_PROMPT = `
[KURUMSAL KAVRAMSAL TASARIM DOKÜMANI ŞABLONU - ZORUNLU]
JetWork tarafından üretilen kavramsal tasarım dokümanı, kullanıcının paylaştığı Word standardındaki yapıya birebir uymalıdır.

businessAnalysis.content içinde şu bölüm sırası ve başlık dili korunacak:
1. KAVRAMSAL TASARIM RAPORU
2. PROJE KİMLİK KARTI
   - Tablo alanları: Proje İsmi, Müşteri İsmi, Proje Yöneticisi, Kapsam Yöneticisi, İş Uygulamaları Sorumlusu, IT Sorumlusu, Çözüm Mimarı.
3. Amaç
4. Doküman Tarihçesi
   - Katılımcılar tablosu: Rol, İsim. En az 6 rol doldurulmalı.
   - Revize tarih tablosu: Tarih, Versiyon, Doküman Revizyon Açıklaması, Yazan.
   - Kontrol EDEN VE ONAYLAYAN tablosu: İsim, Pozisyon, Tarih, İmza. En az 6 onay satırı bulunmalı.
5. İÇİNDEKİLER
   - SÜREÇ TASARIMI
   - Her süreç modeli için: SÜREÇ MODELİ - N "<süreç adı>"
   - EK A
6. SÜREÇ TASARIMI
   - Projenin iş kapsamı, hedefi, uygulanacak kanal/sistemler, ana varsayımları, kapsam dışı ve kritik kararları.
7. Her ana süreç için aynı blok tekrarlanacak:
   - SÜREÇ MODELİ - N "<süreç adı>"
   - Süreç Modeli - N
   - Bu proje ile birlikte;
   - Üst Düzey Süreç Açıklaması
   - Süreç değişiklikleri
   - İş Gerekleri ve KPIs
   - Detaylı Süreç Akışı / Akış Diyagramı
   - Detaylı Süreç Akışı
   - Akış Diyagramı
   - İlgili Süreçler
   - Üst Düzey Müşteri Geliştirmesi
   - Geliştirme tablosu: Geliştirme No, Geliştirme Tipi (Program, Userexit, Arayüz, Rapor, Ürün, İş Akışı), Değişiklik Tipi (Yeni, Değişiklik), Complexity (Düşük, Orta, Yüksek)
   - Önemli Uyarlamalar ve Amaçları
   - Değişim Yönetimi
8. EK A
   - İLGİLİ / REFERANS DOKÜMANLAR tablosu: Doküman İsmi, Versiyon, Özet Açıklama.
   - EKLENTİ tablosu: Doküman İsmi, Versiyon, Özet Açıklama.

Üretim kuralları:
- Eski genel BA raporu formatını kullanma: "Amaç ve İş Değeri / Kapsam / FR / NFR" gibi genel başlıkları bu şablonun alt başlıklarına yedir.
- "BA Analiz Raporu" ile başlama; ana başlık "KAVRAMSAL TASARIM RAPORU" olmalı.
- Her kavramsal dokümanda süreç modeli bloklarını otomatik çoğalt. Genel projelerde en az 2, entegrasyon/SAP/CRM/İYS/doküman yönetimi/dijital sözleşme projelerinde en az 3 adet SÜREÇ MODELİ bloğu üret.
- SAP CRM - İYS için süreç adayları: CRM'den İYS'ye izin aktarımı, İYS'den CRM'e günlük delta/mutabakat, hata-retry-operasyon izleme ve raporlama.
- İş Gerekleri ve KPIs tablosu dolu olmalı: BR, FR, INT, NFR, UI, RPT, SEC, KPI, TEST, OPS kod ailelerinden en az 10 satır hedefle.
- Üst Düzey Müşteri Geliştirmesi tablosunda en az 4 satır olmalı.
- Önemli Uyarlamalar ve Değişim Yönetimi bölümleri somut aksiyonlarla doldurulmalı.
- Bilgi eksikse bölümü atlama. Değeri [VARSAYIM] veya [AÇIK KONU] olarak yaz.
- Chat cevabı kısa olsun; asıl detay businessAnalysis.content içinde bu şablonla yazılsın.
- Review sekmesi; riskler, açık konular ve kalite notlarını içerebilir, ancak ana kavramsal doküman yapısı businessAnalysis.content içinde kalır.
`.trim();

const REQUIRED_TEMPLATE_PATTERNS: RegExp[] = [
  /kavramsal tasar[ıi]m raporu/i,
  /proje kimlik kart[ıi]/i,
  /dok[uü]man tarih[çc]esi/i,
  /kat[ıi]l[ıi]mc[ıi]lar/i,
  /revize tarih/i,
  /kontrol eden ve onaylayan/i,
  /i[çc]indekiler/i,
  /s[uü]re[çc] tasar[ıi]m[ıi]/i,
  /s[uü]re[çc] modeli/i,
  /[uü]st d[uü]zey s[uü]re[çc] a[çc][ıi]klamas[ıi]/i,
  /s[uü]re[çc] de[ğg]i[şs]iklikleri/i,
  /i[şs] gerekleri ve kpi/i,
  /detayl[ıi] s[uü]re[çc] ak[ıi][şs][ıi]/i,
  /ilgili s[uü]re[çc]ler/i,
  /geli[şs]tirme no/i,
  /[öo]nemli uyarlamalar ve ama[çc]lar[ıi]/i,
  /de[ğg]i[şs]im y[oö]netimi/i,
  /ek a/i,
  /ilgili\s*\/\s*referans dok[uü]manlar/i,
  /eklenti/i,
];

const TEMPLATE_LABELS = [
  'KAVRAMSAL TASARIM RAPORU',
  'PROJE KİMLİK KARTI',
  'Doküman Tarihçesi',
  'Katılımcılar',
  'Revize tarih',
  'Kontrol EDEN VE ONAYLAYAN',
  'İÇİNDEKİLER',
  'SÜREÇ TASARIMI',
  'SÜREÇ MODELİ',
  'Üst Düzey Süreç Açıklaması',
  'Süreç değişiklikleri',
  'İş Gerekleri ve KPIs',
  'Detaylı Süreç Akışı',
  'İlgili Süreçler',
  'Geliştirme No',
  'Önemli Uyarlamalar ve Amaçları',
  'Değişim Yönetimi',
  'EK A',
  'İLGİLİ / REFERANS DOKÜMANLAR',
  'EKLENTİ',
];

function stripHtml(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addFlag(flags: string[] | undefined, flag: string): string[] {
  return Array.from(new Set([...(flags || []), flag]));
}

function countProcessModels(content = ''): number {
  const plain = stripHtml(content);
  return (plain.match(/s[uü]re[çc] modeli\s*-\s*\d+/gi) || []).length;
}

function expectedProcessCount(source = ''): number {
  const plain = stripHtml(source);
  if (/(sap|crm|iys|ileti y[oö]netim sistemi|entegrasyon|integration|api|middleware|dijital s[oö]zle[şs]me|dok[uü]man y[oö]netimi|filenet)/i.test(plain)) {
    return 3;
  }
  return 2;
}

export function isConceptualTemplateCompliant(content = ''): boolean {
  const plain = stripHtml(content);
  if (!plain) return false;
  const requiredHits = REQUIRED_TEMPLATE_PATTERNS.filter((pattern) => pattern.test(plain)).length;
  return requiredHits >= REQUIRED_TEMPLATE_PATTERNS.length - 2
    && countProcessModels(plain) >= expectedProcessCount(plain);
}

export function conceptualTemplateCoverage(content = ''): { missing: string[]; passed: number; total: number } {
  const plain = stripHtml(content);
  const missing = TEMPLATE_LABELS.filter((_, index) => !REQUIRED_TEMPLATE_PATTERNS[index].test(plain));
  const expected = expectedProcessCount(plain);
  if (countProcessModels(plain) < expected) {
    missing.push(`En az ${expected} SÜREÇ MODELİ bloğu`);
  }
  return { missing, passed: TEMPLATE_LABELS.length + 1 - missing.length, total: TEMPLATE_LABELS.length + 1 };
}

function inferProjectName(source = ''): string {
  const plain = stripHtml(source);
  const sapIys = /sap/i.test(plain) && /(iys|ileti y[oö]netim sistemi)/i.test(plain);
  if (sapIys) return 'SAP CRM - İYS Entegrasyonu';
  const digitalContract = /(dijital s[oö]zle[şs]me|e-imza|e imza|s[oö]zle[şs]me)/i.test(plain);
  if (digitalContract) return 'Dijital Sözleşme Projesi';
  const firstHeading = plain
    .split(/\n|\. /)
    .map((part) => part.trim())
    .find((part) => part.length >= 12 && part.length <= 90);
  return firstHeading || '[VARSAYIM] Proje adı netleştirilecek';
}

function inferProcessModels(source = ''): string[] {
  const plain = stripHtml(source);
  if (/sap/i.test(plain) && /(iys|ileti y[oö]netim sistemi)/i.test(plain)) {
    return [
      "SAP CRM'den İYS'ye İzin Aktarımı",
      "İYS'den SAP CRM'e Günlük Delta ve Mutabakat",
      'Hata, Retry, Operasyon İzleme ve Raporlama',
    ];
  }
  if (/(dijital s[oö]zle[şs]me|e-imza|e imza|s[oö]zle[şs]me)/i.test(plain)) {
    return [
      'Sözleşme Hazırlama ve Onay Başlatma',
      'Dijital İmza / OTP Doğrulama ve Arşivleme',
      'Hata, İptal, Revizyon ve Operasyon İzleme',
    ];
  }
  if (/(entegrasyon|integration|api|middleware|sap|crm|servis)/i.test(plain)) {
    return [
      'Kaynak Sistemden Hedef Sisteme Veri Aktarımı',
      'Hedef Sistemden Geri Bildirim ve Mutabakat',
      'Hata Yönetimi, Retry ve Operasyonel İzleme',
    ];
  }
  return [
    'Ana İş Süreci',
    'Kontrol, Raporlama ve Operasyonel Takip Süreci',
  ];
}

function buildRequirementsTable(index: number): string {
  const prefix = String(index).padStart(2, '0');
  return [
    '| Gereklilik | Açıklama | Öncelik | Kabul Kriteri | KPI / Hedef |',
    '|---|---|---|---|---|',
    `| BR-${prefix}-01 | [VARSAYIM] Süreç iş kuralı ve yasal/operasyonel kısıtlar korunacaktır. | Yüksek | Kural ihlali durumunda işlem durdurulur veya uyarı verilir. | Uyum oranı >= %99 |`,
    `| FR-${prefix}-01 | [VARSAYIM] Kullanıcı veya sistem tetikleyicisiyle ilgili kayıt oluşturulur/güncellenir. | Yüksek | Zorunlu alanlar tamamlanmadan kayıt ilerlemez. | Başarılı işlem oranı >= %95 |`,
    `| INT-${prefix}-01 | [VARSAYIM] İlgili entegrasyon güvenli servis veya batch yapısıyla çalışır. | Yüksek | Başarılı/başarısız tüm çağrılar izlenebilir. | Entegrasyon hata oranı <= %2 |`,
    `| NFR-${prefix}-01 | [VARSAYIM] Performans ve erişilebilirlik hedefleri operasyon hacmine uygun tasarlanır. | Orta | Kritik ekran/servis kabul edilen SLA içinde yanıt verir. | Yanıt süresi [AÇIK KONU] |`,
    `| UI-${prefix}-01 | [VARSAYIM] Kullanıcı ekranlarında açık validasyon, uyarı ve durum mesajları bulunur. | Orta | Hatalı veri kullanıcıya anlaşılır biçimde gösterilir. | Hatalı kayıt oranı azalır |`,
    `| RPT-${prefix}-01 | [VARSAYIM] Süreç durumu, hata ve bekleyen işler raporlanır. | Orta | Operasyon ekibi günlük raporda bekleyen/hatalı işleri görür. | Günlük rapor üretimi %100 |`,
    `| SEC-${prefix}-01 | [VARSAYIM] Rol bazlı yetki, audit log ve hassas veri koruması uygulanır. | Yüksek | Yetkisiz kullanıcı kritik işlem yapamaz. | Yetki ihlali 0 |`,
    `| KPI-${prefix}-01 | [VARSAYIM] Süreç başarı oranı, mutabakat farkı ve manuel müdahale izlenir. | Orta | KPI panosu veya raporu ile ölçüm yapılır. | Manuel iş yükü azalır |`,
    `| TEST-${prefix}-01 | [VARSAYIM] Pozitif, negatif, entegrasyon hata ve yetki testleri UAT kapsamına alınır. | Yüksek | UAT kritik senaryoları başarıyla tamamlanır. | Kritik açık hata 0 |`,
    `| OPS-${prefix}-01 | [VARSAYIM] Retry, hata iş listesi ve operasyonel sorumluluk matrisi tanımlanır. | Orta | Hatalı kayıtlar takip edilebilir ve yeniden işlenebilir. | Açık hata SLA içinde kapanır |`,
  ].join('\n');
}

function buildProcessModelBlock(title: string, index: number): string {
  return `
## ${index}. SÜREÇ MODELİ - ${index} "${title}"

### Süreç Modeli - ${index}
[VARSAYIM] "${title}" süreci, projenin uçtan uca hedef akışını kurumsal kavramsal tasarım seviyesinde tanımlar.

### Bu proje ile birlikte;
- [VARSAYIM] Manuel veya kopuk ilerleyen iş adımları merkezi ve izlenebilir bir akışa alınacaktır.
- [VARSAYIM] İş birimi, operasyon ve IT ekipleri arasında ortak takip dili oluşacaktır.
- [VARSAYIM] Hata, onay, bekleme, mutabakat ve raporlama ihtiyaçları tek doküman standardında yönetilecektir.

### Üst Düzey Süreç Açıklaması
[VARSAYIM] Süreç; tetikleyicinin alınması, veri ve yetki kontrolleri, iş kuralı validasyonları, sistem/entegrasyon işlemleri, sonuç güncelleme, hata yönetimi, operasyonel takip ve raporlama adımlarından oluşur.

### Süreç değişiklikleri
- [VARSAYIM] Mevcut durumda manuel takip edilen adımlar sistem kontrollü akışa taşınacaktır.
- [VARSAYIM] Kritik karar, hata ve bekleme durumları loglanarak operasyon ekiplerine görünür hale getirilecektir.
- [VARSAYIM] Sürecin çıktıları raporlama ve denetim ihtiyaçlarına uygun şekilde saklanacaktır.

### İş Gerekleri ve KPIs
${buildRequirementsTable(index)}

### Detaylı Süreç Akışı / Akış Diyagramı

### Detaylı Süreç Akışı
1. Süreç tetikleyicisi kullanıcı, batch job veya entegrasyon tarafından başlatılır.
2. Zorunlu alanlar, format kontrolleri, yetki ve iş kuralları doğrulanır.
3. Başarılı validasyon sonrası ilgili sistem güncellemesi veya entegrasyon çağrısı yapılır.
4. Başarılı sonuç ana kayda işlenir ve audit/log kayıtları oluşturulur.
5. Hata durumunda retry, hata iş listesi ve operasyonel bildirim adımları devreye girer.
6. Süreç sonucu raporlanır; gerekiyorsa paydaşlara bildirim gönderilir.

### Akış Diyagramı
\`\`\`mermaid
flowchart TD
  A[Başlangıç] --> B["${title} tetiklenir"]
  B --> C{Validasyon başarılı mı?}
  C -- Evet --> D[Sistem / entegrasyon işlemi]
  C -- Hayır --> E[Uyarı ve düzeltme iş listesi]
  D --> F{Sonuç başarılı mı?}
  F -- Evet --> G[Kayıt güncellenir ve loglanır]
  F -- Hayır --> H[Hata logu, retry ve operasyon bildirimi]
  G --> I[Raporlama ve kapanış]
  H --> I
\`\`\`

### İlgili Süreçler
- [VARSAYIM] Ana operasyon süreci
- [VARSAYIM] Entegrasyon ve veri mutabakat süreci
- [VARSAYIM] Raporlama, denetim ve operasyonel takip süreci

### Üst Düzey Müşteri Geliştirmesi
| Geliştirme No | Geliştirme Tipi (Program, Userexit, Arayüz, Rapor, Ürün, İş Akışı) | Değişiklik Tipi (Yeni, Değişiklik) | Complexity (Düşük, Orta, Yüksek) |
|---|---|---|---|
| GEL-${index}01 | Arayüz | Değişiklik | Orta |
| GEL-${index}02 | Program / Servis | Yeni | Yüksek |
| GEL-${index}03 | Rapor | Değişiklik | Orta |
| GEL-${index}04 | İş Akışı / Operasyon İş Listesi | Yeni | Orta |
| GEL-${index}05 | Entegrasyon Log / Retry Mekanizması | Yeni | Yüksek |

### Önemli Uyarlamalar ve Amaçları
- [VARSAYIM] Parametre ve eşleştirme tabloları iş birimi tarafından yönetilebilir tasarlanacaktır.
- [VARSAYIM] Format, zorunlu alan, yetki ve durum validasyonları merkezi kurallara bağlanacaktır.
- [VARSAYIM] Hata, retry, audit, raporlama ve bildirim yapıları operasyonel izleme için standartlaştırılacaktır.
- [VARSAYIM] Kritik entegrasyon veya veri değişiklikleri geriye dönük izlenebilir olacaktır.

### Değişim Yönetimi
- [VARSAYIM] Canlıya geçiş öncesi iş birimi, IT, operasyon ve destek ekipleri için eğitim/duyuru planı hazırlanacaktır.
- [VARSAYIM] UAT başarı kriterleri tamamlanmadan canlı geçiş yapılmayacaktır.
- [VARSAYIM] Pilot kullanım, canlı geçiş, rollback ve operasyon devri planı açık sorumlularla tanımlanacaktır.
`.trim();
}

function buildFallbackTemplate(sourceContent: string): string {
  const projectName = inferProjectName(sourceContent);
  const today = new Date().toLocaleDateString('tr-TR');
  const processModels = inferProcessModels(sourceContent);
  const processToc = processModels
    .map((title, index) => `- ${index + 1}. SÜREÇ MODELİ - ${index + 1} "${title}"`)
    .join('\n');
  const processBlocks = processModels
    .map((title, index) => buildProcessModelBlock(title, index + 1))
    .join('\n\n');

  return `
# KAVRAMSAL TASARIM RAPORU

## PROJE KİMLİK KARTI
| Alan | Değer |
|---|---|
| Proje İsmi | ${projectName} |
| Müşteri İsmi | [AÇIK KONU] Müşteri/kurum bilgisi netleştirilecek. |
| Proje Yöneticisi | [AÇIK KONU] |
| Kapsam Yöneticisi | [AÇIK KONU] |
| İş Uygulamaları Sorumlusu | [AÇIK KONU] |
| IT Sorumlusu | [AÇIK KONU] |
| Çözüm Mimarı | [AÇIK KONU] |

## Amaç
[VARSAYIM] Bu doküman, kullanıcı talebinde belirtilen ihtiyacı kurumsal kavramsal tasarım formatında analiz etmek ve hedef süreç/sistem değişikliklerini karar verilebilir seviyede tanımlamak için hazırlanmıştır.

## Doküman Tarihçesi

### Katılımcılar
| Rol | İsim |
|---|---|
| Proje Yöneticisi | [AÇIK KONU] |
| Kapsam Yöneticisi | [AÇIK KONU] |
| İş Uygulamaları Sorumlusu | [AÇIK KONU] |
| Veri Yönetimi Sorumlusu | [AÇIK KONU] |
| IT Sorumlusu | [AÇIK KONU] |
| Danışman | [AÇIK KONU] |
| Çözüm Mimarı | [AÇIK KONU] |
| Operasyon Sorumlusu | [AÇIK KONU] |

### Revize tarih
| Tarih | Versiyon | Doküman Revizyon Açıklaması | Yazan |
|---|---|---|---|
| ${today} | V0.1 | İlk kavramsal tasarım taslağı | JetWork AI |

### Kontrol EDEN VE ONAYLAYAN
| İsim | Pozisyon | Tarih | İmza |
|---|---|---|---|
| [AÇIK KONU] | Proje Yöneticisi |  |  |
| [AÇIK KONU] | Kapsam Yöneticisi |  |  |
| [AÇIK KONU] | Danışman |  |  |
| [AÇIK KONU] | Çözüm Mimarı |  |  |
| [AÇIK KONU] | IT Lideri |  |  |
| [AÇIK KONU] | Süreç Liderleri |  |  |
| [AÇIK KONU] | İş Süreci Sahipleri |  |  |
| [AÇIK KONU] | Direktör |  |  |

## İÇİNDEKİLER
- SÜREÇ TASARIMI
${processToc}
- EK A

## SÜREÇ TASARIMI
${sourceContent.trim() || '[VARSAYIM] Süreç tasarımı kullanıcı talebi ve varsayımlarla detaylandırılacaktır.'}

${processBlocks}

## EK A

### İLGİLİ / REFERANS DOKÜMANLAR
| Doküman İsmi | Versiyon | Özet Açıklama |
|---|---|---|
| [AÇIK KONU] Kullanıcı tarafından paylaşılan Word kavramsal tasarım şablonu | [AÇIK KONU] | Doküman format ve onay yapısı referansı. |
| [AÇIK KONU] Mevzuat / API / sistem dokümanları | [AÇIK KONU] | Konuya göre doğrulanacak resmi veya teknik referanslar. |
| [AÇIK KONU] UAT ve geçiş planı | [AÇIK KONU] | Test, canlı geçiş ve operasyon devri referansları. |

### EKLENTİ
| Doküman İsmi | Versiyon | Özet Açıklama |
|---|---|---|
| [AÇIK KONU] Süreç akış diyagramları |  | Detaylı BPMN/Mermaid veya operasyon akışları. |
| [AÇIK KONU] Veri eşleştirme matrisi |  | Alan bazlı veri mapping ve dönüşüm kuralları. |
| [AÇIK KONU] Test kanıtları |  | UAT çıktıları ve kabul onayları. |
`.trim();
}

export function ensureConceptualTemplateStructure(document: DocumentData): DocumentData {
  const businessAnalysis = document.businessAnalysis;
  const content = businessAnalysis?.content || '';
  if (!content.trim() || isConceptualTemplateCompliant(content)) {
    return document;
  }

  return {
    ...document,
    businessAnalysis: {
      content: buildFallbackTemplate(content),
      status: businessAnalysis?.status || 'DRAFT',
      flags: addFlag(businessAnalysis?.flags, 'CONCEPTUAL_TEMPLATE_APPLIED'),
    },
  };
}
