import { marked } from 'marked';
import type { DocumentData, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  changedSections: string[];
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  review: 'Review',
};

const QUALITY_BLOCK_START = '<!-- BA_QUALITY_GATE_START -->';
const QUALITY_BLOCK_END = '<!-- BA_QUALITY_GATE_END -->';

function isHtml(value: string): boolean {
  return /<\/?(h\d|p|table|ul|ol|li|div|section|article|strong|em|pre|code|blockquote|br|span)\b/i.test(value);
}

function looksLikeMarkdown(value: string): boolean {
  return /(^|\n)#{1,4}\s+/.test(value)
    || /\*\*[^*]+\*\*/.test(value)
    || /(^|\n)\s*[-*]\s+/.test(value)
    || /(^|\n)\s*\d+\.\s+/.test(value)
    || /\|\s*[^\n]+\s*\|/.test(value)
    || /```/.test(value);
}

function stripHtml(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForInference(value = ''): string {
  return stripHtml(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderMarkdownToHtml(content = ''): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  if (isHtml(trimmed) && !looksLikeMarkdown(trimmed)) return trimmed;
  return marked.parse(trimmed, { gfm: true, breaks: false }) as string;
}

function replaceMarkedBlock(currentContent: string, nextBlock: string, startMarker: string, endMarker: string): string {
  const current = currentContent || '';
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) return current.replace(blockRegex, nextBlock);
  return [current.trim(), nextBlock].filter(Boolean).join('\n\n');
}

function normalizeSection(section?: SectionData, existing?: SectionData, parseMarkdown = true): SectionData {
  const incomingContent = section?.content?.trim() || '';
  const existingContent = existing?.content || '';
  const content = incomingContent || existingContent;
  const html = parseMarkdown ? renderMarkdownToHtml(content) : content;

  return {
    content: html,
    status: section?.status || existing?.status || 'DRAFT',
    flags: Array.from(new Set([...(existing?.flags || []), ...(section?.flags || [])])),
  };
}

function sectionsDiffer(a?: SectionData, b?: SectionData): boolean {
  return (a?.content || '') !== (b?.content || '')
    || (a?.status || '') !== (b?.status || '')
    || JSON.stringify(a?.flags || []) !== JSON.stringify(b?.flags || []);
}

function countProcessModels(content = ''): number {
  const normalized = normalizeForInference(content);
  const matches = Array.from(normalized.matchAll(/surec modeli\s*-\s*(\d+)/gi)).map((match) => match[1]);
  return new Set(matches).size;
}

function inferProjectName(source = ''): string {
  const plain = stripHtml(source);
  const normalized = normalizeForInference(source);
  if (/d2d|saha satis|mobil|mobile|refactoring|refaktoring/.test(normalized)) return 'D2D Saha Satış Uygulaması Mobil Dönüşüm ve Refactoring Projesi';
  if (/sap/.test(normalized) && /crm/.test(normalized) && /iys|ileti yonetim sistemi/.test(normalized)) return 'SAP CRM / C4C - İYS Entegrasyonu Projesi';
  if (/sap/.test(normalized) && /crm/.test(normalized) && /ai|bot|satis botu|lead|opportunity|firsat/.test(normalized)) return 'SAP CRM AI Satış Botu Projesi';
  const firstSentence = plain.split(/\n|\. /).map((part) => part.trim()).find((part) => part.length >= 12 && part.length <= 100);
  return firstSentence || '[VARSAYIM] Proje adı netleştirilecek';
}

function inferProcessModels(source = ''): string[] {
  const normalized = normalizeForInference(source);
  if (/d2d|saha satis|mobil|mobile|refactoring|refaktoring/.test(normalized)) {
    return [
      'Saha Ziyaret Planlama ve Temsilci Günlük Rota Yönetimi',
      'Müşteri Adayı Oluşturma, Doğrulama ve Teklif Akışı',
      'Offline Veri Toplama, Senkronizasyon ve Çakışma Yönetimi',
      'Saha Satış Onay, Evrak ve Operasyonel İzleme Süreci',
    ];
  }
  if (/sap/.test(normalized) && /crm/.test(normalized) && /iys|ileti yonetim sistemi/.test(normalized)) {
    return [
      "SAP CRM / C4C'den İYS'ye İzin Aktarımı",
      "İYS'den SAP CRM / C4C'ye Günlük Delta ve Mutabakat",
      'Initial Load, Hata-Retry ve Operasyonel İzleme Süreci',
    ];
  }
  if (/sap/.test(normalized) && /crm/.test(normalized) && /ai|bot|satis botu|lead|opportunity|firsat/.test(normalized)) {
    return [
      'AI Bot ile Lead Kazanımı ve Niyet Anlama',
      'Lead Nitelendirme, Ürün/Teklif Önerisi ve Güven Skoru',
      'SAP CRM Kaydı, Temsilciye Devir ve Satış Takibi',
      'AI Kalite, Model İzleme ve Operasyonel Raporlama',
    ];
  }
  if (/entegrasyon|integration|api|middleware|sap|crm/.test(normalized)) {
    return [
      'Kaynak Sistemden Hedef Sisteme Veri Aktarımı',
      'Hedef Sistem Geri Bildirim ve Mutabakat',
      'Hata Yönetimi, Retry ve Operasyonel İzleme',
    ];
  }
  return ['Ana İş Süreci', 'Kontrol, Raporlama ve Operasyonel Takip Süreci'];
}

function buildRequirementsTable(index: number): string {
  const prefix = String(index).padStart(2, '0');
  return [
    '| Gereklilik | Açıklama | Öncelik | Kabul Kriteri | KPI / Hedef |',
    '|---|---|---|---|---|',
    `| BR-${prefix}-01 | [VARSAYIM] Süreç için iş kuralı, rol ve karar noktaları merkezi olarak yönetilir. | Yüksek | Kural ihlali durumunda işlem durdurulur veya kullanıcı uyarılır. | Uyum oranı >= %99 |`,
    `| FR-${prefix}-01 | [VARSAYIM] Kullanıcı veya sistem tetikleyicisiyle ilgili kayıt oluşturulur/güncellenir. | Yüksek | Zorunlu alanlar tamamlanmadan kayıt ilerlemez. | Başarılı işlem oranı >= %95 |`,
    `| INT-${prefix}-01 | [VARSAYIM] İlgili entegrasyon güvenli servis, batch veya senkronizasyon katmanıyla çalışır. | Yüksek | Başarılı/başarısız tüm çağrılar izlenebilir. | Entegrasyon hata oranı <= %2 |`,
    `| NFR-${prefix}-01 | [VARSAYIM] Performans, offline çalışma, erişilebilirlik ve güvenlik hedefleri kullanım hacmine uygun tasarlanır. | Orta | Kritik ekran/servis kabul edilen SLA içinde yanıt verir. | Yanıt süresi [AÇIK KONU] |`,
    `| UI-${prefix}-01 | [VARSAYIM] Ekranlarda açık validasyon, toast, uyarı ve yönlendirici mesajlar bulunur. | Orta | Hatalı veri kullanıcıya anlaşılır biçimde gösterilir. | Hatalı kayıt oranı azalır |`,
    `| RPT-${prefix}-01 | [VARSAYIM] Süreç durumu, hata, bekleyen iş ve KPI raporlanır. | Orta | Operasyon ekibi günlük raporda bekleyen/hatalı işleri görür. | Günlük rapor üretimi %100 |`,
    `| SEC-${prefix}-01 | [VARSAYIM] Rol bazlı yetki, audit log ve hassas veri koruması uygulanır. | Yüksek | Yetkisiz kullanıcı kritik işlem yapamaz. | Yetki ihlali 0 |`,
    `| TEST-${prefix}-01 | [VARSAYIM] Pozitif, negatif, entegrasyon hata ve yetki testleri UAT kapsamına alınır. | Yüksek | Kritik UAT senaryoları başarıyla tamamlanır. | Kritik açık hata 0 |`,
  ].join('\n');
}

function buildProcessSpecificNotes(title: string): string {
  const normalized = normalizeForInference(title);
  if (/saha|rota|ziyaret/.test(normalized)) {
    return '- [VARSAYIM] Temsilci günlük rota, bölge, müşteri adayı ve ziyaret statüsü mobil uygulamada izlenir.\n- [VARSAYIM] GPS, zaman damgası ve ziyaret sonucu audit amacıyla saklanır.\n- [VARSAYIM] Günlük performans KPI panosunda ziyaret sayısı, başarılı görüşme ve açık aksiyon takip edilir.';
  }
  if (/offline|senkron/.test(normalized)) {
    return '- [VARSAYIM] Mobil uygulama offline-first çalışır; bağlantı geldiğinde delta sync yapılır.\n- [VARSAYIM] Çakışma durumunda son güncelleme, temsilci rolü ve merkez sistem önceliğine göre karar verilir.\n- [VARSAYIM] Başarısız senkronizasyon kayıtları hata iş listesine düşer.';
  }
  if (/iys|izin/.test(normalized)) {
    return '- [VARSAYIM] Onay/ret verisi kanal, alıcı, kaynak, tarih ve marka bazında tutulur.\n- [AÇIK KONU] İYS API alanları, marka kodları ve aktarım süreleri resmi kaynakla doğrulanacaktır.\n- [VARSAYIM] Ret sonrası ticari ileti gönderimi durdurulur ve CRM/C4C izin statüsü güncellenir.';
  }
  if (/ai|lead|bot|temsilci/.test(normalized)) {
    return '- [VARSAYIM] AI yanıtları güven skoru ve insan onayı kurallarına göre çalışır.\n- [VARSAYIM] Düşük güven, fiyat taahhüdü, KVKK riski veya şikayet anında temsilciye devir yapılır.\n- [VARSAYIM] CRM lead, opportunity, activity ve conversation log kayıtları izlenebilir tutulur.';
  }
  return '- [VARSAYIM] Sürece özgü ekran, görev, belge, entegrasyon ve raporlama kuralları detay tasarımda netleştirilecektir.';
}

function buildProcessModelBlock(title: string, index: number): string {
  return `## ${index}. SÜREÇ MODELİ - ${index} "${title}"

### Süreç Modeli - ${index}
[VARSAYIM] "${title}" süreci, hedef operasyon akışını kavramsal tasarım seviyesinde tanımlar.

### Bu proje ile birlikte;
- [VARSAYIM] Manuel veya kopuk ilerleyen iş adımları merkezi ve izlenebilir akışa alınacaktır.
- [VARSAYIM] İş birimi, operasyon ve IT ekipleri arasında ortak takip dili oluşacaktır.
- [VARSAYIM] Hata, onay, bekleme, mutabakat ve raporlama ihtiyaçları tek doküman standardında yönetilecektir.

### Üst Düzey Süreç Açıklaması
[VARSAYIM] Süreç; tetikleyici, veri/yetki kontrolü, iş kuralı validasyonu, sistem/entegrasyon işlemi, sonuç güncelleme, hata yönetimi ve operasyonel raporlama adımlarından oluşur.

### Süreç değişiklikleri
- [VARSAYIM] Mevcut manuel takip adımları sistem kontrollü akışa taşınacaktır.
- [VARSAYIM] Kritik karar, hata ve bekleme durumları loglanarak operasyon ekiplerine görünür hale getirilecektir.

### Sürece Özgü İş Kuralları, Ekranlar ve Dokümanlar
${buildProcessSpecificNotes(title)}

### İş Gerekleri ve KPIs
${buildRequirementsTable(index)}

### Detaylı Süreç Akışı / Akış Diyagramı
1. Süreç kullanıcı, mobil uygulama, batch job veya entegrasyon tetikleyicisiyle başlar.
2. Zorunlu alanlar, format kontrolleri, yetki ve iş kuralları doğrulanır.
3. Başarılı validasyon sonrası kayıt güncellenir veya entegrasyon çağrısı yapılır.
4. Hata durumunda kullanıcı mesajı, retry ve operasyonel iş listesi devreye girer.
5. Süreç sonucu raporlanır ve gerekiyorsa paydaşlara bildirim gönderilir.

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
| Geliştirme No | Geliştirme Tipi | Değişiklik Tipi | Complexity |
|---|---|---|---|
| GEL-${index}01 | Arayüz | Değişiklik | Orta |
| GEL-${index}02 | Program / Servis | Yeni | Yüksek |
| GEL-${index}03 | Rapor | Değişiklik | Orta |
| GEL-${index}04 | İş Akışı / Operasyon İş Listesi | Yeni | Orta |

### Önemli Uyarlamalar ve Amaçları
- [VARSAYIM] Parametre ve eşleştirme tabloları iş birimi tarafından yönetilebilir tasarlanacaktır.
- [VARSAYIM] Format, zorunlu alan, yetki ve durum validasyonları merkezi kurallara bağlanacaktır.
- [VARSAYIM] Hata, retry, audit, raporlama ve bildirim yapıları standartlaştırılacaktır.

### Değişim Yönetimi
- [VARSAYIM] Canlıya geçiş öncesi iş birimi, IT, operasyon ve destek ekipleri için eğitim/duyuru planı hazırlanacaktır.
- [VARSAYIM] UAT başarı kriterleri tamamlanmadan canlı geçiş yapılmayacaktır.`;
}

function isTemplateCompliant(content = ''): boolean {
  const normalized = normalizeForInference(content);
  return normalized.includes('kavramsal tasarim raporu')
    && normalized.includes('proje kimlik karti')
    && normalized.includes('dokuman tarihcesi')
    && normalized.includes('surec tasarimi')
    && normalized.includes('kontrol eden ve onaylayan')
    && countProcessModels(content) >= 2;
}

function buildFallbackTemplate(sourceContent: string): string {
  if (isTemplateCompliant(sourceContent)) return sourceContent;
  const projectName = inferProjectName(sourceContent);
  const today = new Date().toLocaleDateString('tr-TR');
  const processModels = inferProcessModels(sourceContent);
  const processToc = processModels.map((title, index) => `- ${index + 1}. SÜREÇ MODELİ - ${index + 1} "${title}"`).join('\n');
  const processBlocks = processModels.map((title, index) => buildProcessModelBlock(title, index + 1)).join('\n\n');

  return `# KAVRAMSAL TASARIM RAPORU

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
| [AÇIK KONU] Süreç akış diyagramları |  | Mermaid/BPMN veya operasyon akışları BA Analiz içinde üretilecektir. |
| [AÇIK KONU] Veri eşleştirme matrisi |  | Alan bazlı veri mapping ve dönüşüm kuralları. |
| [AÇIK KONU] Test kanıtları |  | UAT çıktıları ve kabul onayları. |`;
}

function ensureCorporateTemplate(document: DocumentData): DocumentData {
  const businessAnalysis = document.businessAnalysis;
  const content = businessAnalysis?.content || '';
  if (!content.trim() || isTemplateCompliant(content)) return document;
  return {
    ...document,
    businessAnalysis: {
      content: buildFallbackTemplate(content),
      status: businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([...(businessAnalysis?.flags || []), 'CONCEPTUAL_TEMPLATE_APPLIED'])),
    },
  };
}

export function postProcessDocumentData(incoming: DocumentData, existing?: DocumentData | null): DocumentPostProcessResult {
  const base = existing || {
    businessAnalysis: { content: '', status: 'DRAFT' as const, flags: [] },
    review: { content: '', status: 'DRAFT' as const, flags: [] },
  };

  const incomingWithDefaults: DocumentData = {
    ...incoming,
    businessAnalysis: incoming.businessAnalysis || base.businessAnalysis,
    review: incoming.review || base.review,
  };
  const templatedIncoming = ensureCorporateTemplate(incomingWithDefaults);

  const document: DocumentData = {
    businessAnalysis: normalizeSection(templatedIncoming.businessAnalysis, base.businessAnalysis, true),
    ...(templatedIncoming.review || base.review ? { review: normalizeSection(templatedIncoming.review, base.review, true) } : {}),
    suggestions: incoming.suggestions || base.suggestions,
  };

  const qualityGate = evaluateDocumentQualityGate(document);
  const qualityFlags = [
    ...qualityGate.warnings,
    ...(!qualityGate.canPublishToPanel ? [qualityGate.reason] : []),
  ];

  const qualityBlock = renderMarkdownToHtml([
    QUALITY_BLOCK_START,
    '## BA Analiz Kalite Kapısı',
    `**Kalite Puanı:** ${qualityGate.score}/100`,
    `**Durum:** ${qualityGate.canPublishToPanel ? 'Taslak yayınlanabilir' : 'Eksik / revizyon gerekli'}`,
    '',
    '### Eksik veya Zayıf Alanlar',
    ...(qualityGate.missingSections.length ? qualityGate.missingSections.map((item) => `- ${item}`) : ['- Kritik eksik bulunmadı.']),
    '',
    '### Uyarılar',
    ...(qualityFlags.length ? qualityFlags.map((item) => `- ${item}`) : ['- Uyarı yok.']),
    QUALITY_BLOCK_END,
  ].join('\n'));

  document.review = {
    content: replaceMarkedBlock(document.review?.content || '', qualityBlock, QUALITY_BLOCK_START, QUALITY_BLOCK_END),
    status: qualityGate.canPublishToPanel ? (document.review?.status || 'DRAFT') : 'NEEDS_REVISION',
    flags: Array.from(new Set([...(document.review?.flags || []), ...qualityFlags])),
  };

  document.score = qualityGate.score;
  document.scoreExplanation = qualityGate.reason;

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, changedSections };
}
