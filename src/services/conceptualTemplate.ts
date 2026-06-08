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
   - Katılımcılar tablosu: Rol, İsim.
   - Revize tarih tablosu: Tarih, Versiyon, Doküman Revizyon Açıklaması, Yazan.
   - Kontrol EDEN VE ONAYLAYAN tablosu: İsim, Pozisyon, Tarih, İmza.
5. İÇİNDEKİLER
   - SÜREÇ TASARIMI
   - Her süreç modeli için: SÜREÇ MODELİ - N "<süreç adı>"
   - EK A
6. SÜREÇ TASARIMI
   - Projenin iş kapsamı, hedefi, uygulanacak kanal/sistemler ve ana varsayımları.
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
- Her entegrasyon veya sistem kapsamı için ayrı SÜREÇ MODELİ bloğu aç. Örnek: CRM'den dış sisteme aktarım, dış sistemden mutabakat, hata/operasyon izleme.
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

export function isConceptualTemplateCompliant(content = ''): boolean {
  const plain = stripHtml(content);
  if (!plain) return false;
  const requiredHits = REQUIRED_TEMPLATE_PATTERNS.filter((pattern) => pattern.test(plain)).length;
  return requiredHits >= REQUIRED_TEMPLATE_PATTERNS.length - 2;
}

export function conceptualTemplateCoverage(content = ''): { missing: string[]; passed: number; total: number } {
  const plain = stripHtml(content);
  const missing = TEMPLATE_LABELS.filter((_, index) => !REQUIRED_TEMPLATE_PATTERNS[index].test(plain));
  return { missing, passed: TEMPLATE_LABELS.length - missing.length, total: TEMPLATE_LABELS.length };
}

function inferProjectName(source = ''): string {
  const plain = stripHtml(source);
  const sapIys = /sap/i.test(plain) && /(iys|ileti y[oö]netim sistemi)/i.test(plain);
  if (sapIys) return 'SAP CRM - İYS Entegrasyonu';
  const firstHeading = plain
    .split(/\n|\. /)
    .map((part) => part.trim())
    .find((part) => part.length >= 12 && part.length <= 90);
  return firstHeading || '[VARSAYIM] Proje adı netleştirilecek';
}

function buildFallbackTemplate(sourceContent: string): string {
  const projectName = inferProjectName(sourceContent);
  const today = new Date().toLocaleDateString('tr-TR');
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
- 1. SÜREÇ MODELİ - 1 "${projectName} Ana Süreci"
- EK A

## SÜREÇ TASARIMI
${sourceContent.trim() || '[VARSAYIM] Süreç tasarımı kullanıcı talebi ve varsayımlarla detaylandırılacaktır.'}

## 1. SÜREÇ MODELİ - 1 "${projectName} Ana Süreci"

### Süreç Modeli - 1
[VARSAYIM] Ana süreç modeli, talebin uçtan uca iş akışına göre detaylandırılacaktır.

### Bu proje ile birlikte;
- [VARSAYIM] Manuel veya kopuk ilerleyen iş adımları merkezi süreç yapısına alınacaktır.
- [VARSAYIM] Sistemler arası veri tutarlılığı, izlenebilirlik ve operasyonel kontrol artırılacaktır.
- [VARSAYIM] Hata, onay, bekleme ve raporlama ihtiyaçları tek doküman standardında takip edilecektir.

### Üst Düzey Süreç Açıklaması
[VARSAYIM] Süreç; talep oluşumu, veri doğrulama, sistem/entegrasyon tetikleme, sonuç işleme, operasyonel izleme ve raporlama adımlarından oluşur.

### Süreç değişiklikleri
- [VARSAYIM] Mevcut manuel takip yerine sistem kontrollü akışa geçilecektir.
- [VARSAYIM] Ana sistem kaydı ile harici sistem durumları mutabık hale getirilecektir.
- [VARSAYIM] Hata ve bekleme durumları operasyon ekiplerine izlenebilir iş listesi olarak düşürülecektir.

### İş Gerekleri ve KPIs
| Gereklilik | Açıklama | KPI | Hedef |
|---|---|---|---|
| BR-01 | [VARSAYIM] Ana iş kuralı ve yasal/operasyonel kısıtlar korunacaktır. | İşlem başarı oranı | >= %95 |
| FR-01 | [VARSAYIM] Kullanıcı veya sistem tetiği ile ilgili kayıt güncellenecektir. | Ortalama işlem süresi | [AÇIK KONU] |
| INT-01 | [VARSAYIM] Harici sistem entegrasyonu loglanacak ve tekrar denenebilir olacaktır. | Hatalı entegrasyon sayısı | Günlük takip |

### Detaylı Süreç Akışı / Akış Diyagramı

### Detaylı Süreç Akışı
1. Kullanıcı veya sistem ilgili talebi/kaydı oluşturur.
2. Zorunlu alanlar ve iş kuralları kontrol edilir.
3. Gerekli entegrasyon veya sistem güncellemesi tetiklenir.
4. Başarılı sonuç kayda işlenir; hata durumunda iş listesi/log oluşturulur.
5. Süreç sonucu raporlanır ve gerekiyorsa ilgili paydaşlara bildirim gönderilir.

### Akış Diyagramı
\`\`\`mermaid
flowchart TD
  A[Başlangıç] --> B[Kayıt / Talep Alınır]
  B --> C{Validasyon Başarılı mı?}
  C -- Evet --> D[Sistem / Entegrasyon Tetiklenir]
  C -- Hayır --> E[Uyarı ve Düzeltme İş Listesi]
  D --> F{Sonuç Başarılı mı?}
  F -- Evet --> G[Kayıt Güncellenir]
  F -- Hayır --> H[Hata Logu ve Retry]
  G --> I[Raporlama / Bildirim]
  H --> I
\`\`\`

### İlgili Süreçler
- [VARSAYIM] Ana operasyon süreci
- [VARSAYIM] Entegrasyon izleme süreci
- [VARSAYIM] Raporlama ve mutabakat süreci

### Üst Düzey Müşteri Geliştirmesi
| Geliştirme No | Geliştirme Tipi (Program, Userexit, Arayüz, Rapor, Ürün, İş Akışı) | Değişiklik Tipi (Yeni, Değişiklik) | Complexity (Düşük, Orta, Yüksek) |
|---|---|---|---|
| GEL-01 | Arayüz | Değişiklik | Orta |
| GEL-02 | Program / Servis | Yeni | Yüksek |
| GEL-03 | Rapor | Değişiklik | Orta |

### Önemli Uyarlamalar ve Amaçları
- [VARSAYIM] Parametre tablolarının iş birimi tarafından yönetilebilir olması sağlanacaktır.
- [VARSAYIM] Hata, retry ve audit kayıtları operasyonel izleme için standartlaştırılacaktır.

### Değişim Yönetimi
- [VARSAYIM] Süreç değişikliği canlıya geçiş öncesi iş birimi, IT ve operasyon ekipleriyle duyurulacaktır.
- [VARSAYIM] UAT tamamlanmadan canlı geçiş yapılmayacaktır.

## EK A

### İLGİLİ / REFERANS DOKÜMANLAR
| Doküman İsmi | Versiyon | Özet Açıklama |
|---|---|---|
| [AÇIK KONU] |  | Referans dokümanlar netleştirilecek. |

### EKLENTİ
| Doküman İsmi | Versiyon | Özet Açıklama |
|---|---|---|
| [AÇIK KONU] |  | Eklenti veya destek dokümanları netleştirilecek. |
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
