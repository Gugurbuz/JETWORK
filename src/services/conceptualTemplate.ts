import type { DocumentData } from '../types';
import {
  deriveProcessCandidates,
  deriveProjectNameFromText,
  expectedProcessCountFromSignals,
} from './sourceDrivenInference';
import {
  expectedProcessCountFromProfiles,
  getPrimaryDomainProfile,
  inferredProjectNameFromProfile,
  PEMP_PROCESS_TITLES as PROFILE_PEMP_PROCESS_TITLES,
  processTitlesFromProfile,
} from './domainProfiles';

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
- Kaynak talep dokümanında açık süreç numaraları veya süreç başlıkları varsa süreç modeli adları ve sırası kaynaktan alınır; genel entegrasyon kalıpları kaynak süreçlerin yerine geçemez.
- SAP CRM - İYS için süreç adayları yalnızca talep gerçekten SAP CRM - İYS ise kullanılır: CRM'den İYS'ye izin aktarımı, İYS'den CRM'e günlük delta/mutabakat, hata-retry-operasyon izleme ve raporlama.
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

const NORMALIZED_TEMPLATE_TOKENS = [
  'kavramsal tasarim raporu',
  'proje kimlik karti',
  'dokuman tarihcesi',
  'katilimcilar',
  'revize tarih',
  'kontrol eden ve onaylayan',
  'icindekiler',
  'surec tasarimi',
  'surec modeli',
  'ust duzey surec aciklamasi',
  'surec degisiklikleri',
  'is gerekleri ve kpi',
  'detayli surec akisi',
  'ilgili surecler',
  'gelistirme no',
  'onemli uyarlamalar ve amaclari',
  'degisim yonetimi',
  'ek a',
  'ilgili / referans dokumanlar',
  'eklenti',
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

function normalizeForInference(value = ''): string {
  return stripHtml(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTemplateHits(content = ''): number {
  const normalized = normalizeForInference(content);
  return NORMALIZED_TEMPLATE_TOKENS.filter(token => normalized.includes(token)).length;
}

function missingTemplateLabels(content = ''): string[] {
  const normalized = normalizeForInference(content);
  return TEMPLATE_LABELS.filter((_, index) => !normalized.includes(NORMALIZED_TEMPLATE_TOKENS[index]));
}

function isDigitalContractRequest(source = ''): boolean {
  return getPrimaryDomainProfile(source)?.id === 'digital_contract';
}

function isFieldMobileRequest(source = ''): boolean {
  return getPrimaryDomainProfile(source)?.id === 'field_mobile_app';
}

function isProjectTrackingRequest(source = ''): boolean {
  return getPrimaryDomainProfile(source)?.id === 'project_tracking_pemp';
}

const PEMP_PROCESS_TITLES = PROFILE_PEMP_PROCESS_TITLES;

function isGenericIntegrationProcessTitle(title = ''): boolean {
  const normalized = normalizeForInference(title);
  return /kaynak sistemden hedef sisteme|hedef sistem.*geri bildirim|hedef sistem.*mutabakat|hata yonetimi.*retry|ana is sureci|kontrol raporlama ve operasyonel takip/.test(normalized);
}

function hasGenericProcessContamination(content = ''): boolean {
  return extractProcessModelTitles(content).some(isGenericIntegrationProcessTitle);
}

function stripProcessModelBlocks(content = ''): string {
  const lines = content.replace(/<br\s*\/?>/gi, '\n').split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const normalized = normalizeForInference(line);
    const isProcessHeader = /(^|\s)(surec modeli\s*-\s*\d+)/.test(normalized);
    const isAppendixHeader = /^#+\s*ek a\b/.test(normalized) || /^ek a$/.test(normalized);

    if (isProcessHeader) {
      skipping = true;
      continue;
    }
    if (skipping && isAppendixHeader) {
      skipping = false;
      kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractExplicitProcessModels(source = ''): string[] {
  const plain = normalizeForInference(source);
  const processNumbers = Array.from(plain.matchAll(/surec\s*([0-9]+)/gi))
    .map(match => Number(match[1]))
    .filter(number => Number.isInteger(number) && number >= 0 && number <= 30);
  const uniqueNumbers = Array.from(new Set(processNumbers)).sort((a, b) => a - b);

  if (uniqueNumbers.length >= 4 && isProjectTrackingRequest(source)) {
    return uniqueNumbers
      .filter(number => number >= 0 && number < PEMP_PROCESS_TITLES.length)
      .map(number => PEMP_PROCESS_TITLES[number]);
  }

  return [];
}

function addFlag(flags: string[] | undefined, flag: string): string[] {
  return Array.from(new Set([...(flags || []), flag]));
}

function countProcessModels(content = ''): number {
  const titles = extractProcessModelTitles(content);
  return Math.max(titles.length, countProcessModelMarkers(content));
}

function countProcessModelMarkers(content = ''): number {
  const plain = stripHtml(content);
  const normalized = normalizeForInference(content);
  const numbers = [
    ...Array.from(plain.matchAll(/s[uü]re[çc] modeli\s*-\s*(\d+)/gi)),
    ...Array.from(normalized.matchAll(/surec modeli\s*-\s*(\d+)/gi)),
  ]
    .map(match => match[1])
    .filter(Boolean);
  return new Set(numbers).size;
}

function extractProcessModelTitles(content = ''): string[] {
  const titles: string[] = [];
  const plainLines = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, '\n')
    .split(/\r?\n/)
    .map(line => stripHtml(line).replace(/^[-#*\s\d.]+/, '').trim())
    .filter(Boolean);

  for (const line of plainLines) {
    const match = line.match(/s[uü]re[çc]\s+modeli\s*-\s*\d+\s*(?:"([^"]+)"|“([^”]+)”|:\s*([^|]+)|-\s*([^|]+)|\s+([^|]+))?/i);
    const title = (match?.[1] || match?.[2] || match?.[3] || match?.[4] || match?.[5] || '')
      .replace(/^[":“”\s]+|[":“”\s]+$/g, '')
      .trim();
    if (title && !titles.some(existing => normalizeForInference(existing) === normalizeForInference(title))) {
      titles.push(title);
    }
  }

  return titles;
}

function isPartiallyStructuredConceptualDraft(content = ''): boolean {
  const normalized = normalizeForInference(content);
  const plain = stripHtml(content);
  const hasProcessModelMarker =
    /s[uü]re[çc]\s+modeli\s*-\s*\d+/i.test(plain)
    || /surec modeli\s*-\s*\d+/i.test(normalized);
  return normalized.includes('kavramsal tasarim raporu')
    && hasProcessModelMarker;
}

function missingProcessTitlesForPartialDraft(sourceContent: string, inferenceContent = sourceContent): string[] {
  const existingTitles = extractProcessModelTitles(sourceContent);
  const existingProcessCount = countProcessModels(sourceContent);
  const inferredProcessModels = inferProcessModels(inferenceContent);
  const targetCount = Math.max(
    expectedProcessCount(inferenceContent),
    existingProcessCount,
    inferredProcessModels.length,
  );
  const missingCount = Math.max(0, targetCount - existingProcessCount);
  if (!missingCount) return [];

  const seen = new Set(existingTitles.map(title => normalizeForInference(title)));
  const preferred = inferredProcessModels
    .slice(existingProcessCount)
    .filter(title => !seen.has(normalizeForInference(title)));
  const remaining = inferredProcessModels
    .filter(title => !seen.has(normalizeForInference(title)) && !preferred.some(item => normalizeForInference(item) === normalizeForInference(title)));

  return [...preferred, ...remaining].slice(0, missingCount);
}

function buildAppendixIfMissing(sourceContent: string): string {
  const normalized = normalizeForInference(sourceContent);
  if (normalized.includes('ek a') && normalized.includes('referans dokuman')) return '';

  return `
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

function completePartialConceptualDraft(sourceContent: string, inferenceContent = sourceContent): string {
  if (isProjectTrackingRequest(inferenceContent) && hasGenericProcessContamination(sourceContent)) {
    return buildFallbackTemplate(stripProcessModelBlocks(sourceContent), inferenceContent);
  }

  const existingCount = countProcessModels(sourceContent);
  const missingBlocks = missingProcessTitlesForPartialDraft(sourceContent, inferenceContent)
    .map((title, index) => buildProcessModelBlock(title, existingCount + index + 1))
    .join('\n\n');
  const appendix = buildAppendixIfMissing(sourceContent);
  return [sourceContent.trim(), missingBlocks, appendix].filter(Boolean).join('\n\n');
}

function mergeProcessModelTitles(existingTitles: string[], inferredTitles: string[], targetCount: number): string[] {
  const merged: string[] = [];

  [...existingTitles, ...inferredTitles].forEach((title) => {
    if (!title) return;
    const normalized = normalizeForInference(title);
    if (!merged.some(existing => normalizeForInference(existing) === normalized)) {
      merged.push(title);
    }
  });

  return merged.slice(0, Math.max(targetCount, existingTitles.length || 0));
}

function isRichConceptualDraft(content = ''): boolean {
  const plain = stripHtml(content);
  if (!plain) return false;
  const normalized = normalizeForInference(plain);
  const requiredHits = countTemplateHits(plain);
  const hasConceptualTitle = normalized.includes('kavramsal tasarim raporu');
  const hasIdentity = normalized.includes('proje kimlik karti');
  const hasProcessDesign = normalized.includes('surec tasarimi');
  const hasEnoughProcessModels = countProcessModels(plain) >= expectedProcessCount(plain);
  const hasRequirements = /(is gerekleri ve kpi|br-\d|fr-\d|int-\d|nfr-\d)/i.test(normalized);

  return hasConceptualTitle
    && hasIdentity
    && hasProcessDesign
    && hasEnoughProcessModels
    && hasRequirements
    && requiredHits >= 8;
}

function hasProjectTrackingProcessCoverage(content = ''): boolean {
  const normalized = normalizeForInference(content);
  const covered = PEMP_PROCESS_TITLES.filter(title => normalized.includes(normalizeForInference(title))).length;
  return covered >= Math.max(8, PEMP_PROCESS_TITLES.length - 1);
}

function shouldRebuildFromSource(content = '', sourceContext = ''): boolean {
  if (!sourceContext.trim()) return false;
  if (!isProjectTrackingRequest(sourceContext)) return false;
  return hasGenericProcessContamination(content) || !hasProjectTrackingProcessCoverage(content);
}

function expectedProcessCount(source = ''): number {
  const plain = stripHtml(source);
  const explicitProcesses = extractExplicitProcessModels(source);
  if (explicitProcesses.length >= 2) return explicitProcesses.length;
  if (isProjectTrackingRequest(source)) return PEMP_PROCESS_TITLES.length;
  const fallbackMin = /(entegrasyon|integration|api|middleware|servis|dok[uü]man|belge|workflow|onay|dashboard|rapor)/i.test(plain) ? 3 : 2;
  return expectedProcessCountFromSignals({
    sourceText: source,
    minCount: expectedProcessCountFromProfiles(source, fallbackMin),
  });
}

export function isConceptualTemplateCompliant(content = ''): boolean {
  const plain = stripHtml(content);
  if (!plain) return false;
  const requiredHits = countTemplateHits(plain);
  return requiredHits >= REQUIRED_TEMPLATE_PATTERNS.length - 2
    && countProcessModels(plain) >= expectedProcessCount(plain);
}

export function conceptualTemplateCoverage(content = ''): { missing: string[]; passed: number; total: number } {
  const plain = stripHtml(content);
  const missing = missingTemplateLabels(plain);
  const expected = expectedProcessCount(plain);
  if (countProcessModels(plain) < expected) {
    missing.push(`En az ${expected} SÜREÇ MODELİ bloğu`);
  }
  return { missing, passed: TEMPLATE_LABELS.length + 1 - missing.length, total: TEMPLATE_LABELS.length + 1 };
}

function inferProjectName(source = ''): string {
  const sourceDrivenName = deriveProjectNameFromText(source);
  if (sourceDrivenName) return sourceDrivenName;
  const profileName = inferredProjectNameFromProfile(source);
  if (profileName) return profileName;
  return '[VARSAYIM] Proje adi netlestirilecek';
}

function inferProcessModels(source = ''): string[] {
  const explicitProcesses = extractExplicitProcessModels(source);
  if (explicitProcesses.length) return explicitProcesses;
  const profileProcesses = processTitlesFromProfile(source);
  if (profileProcesses.length) return profileProcesses;
  return deriveProcessCandidates({
    sourceText: source,
    minCount: expectedProcessCount(source),
    maxCount: Math.max(expectedProcessCount(source), 8),
  });
}

function requirementTheme(title: string): {
  br: string;
  fr: string;
  int: string;
  kpi: string;
  test: string;
} {
  const normalized = normalizeForInference(title);
  if (normalized.includes('proje kayd')) {
    return {
      br: 'Sözleşme "İmzalandı" statüsüne gelmeden proje kaydı oluşturulmamalı; zorunlu müşteri, proje, lokasyon, KAM ve finans alanları tamamlanmadan süreç kapanmamalıdır.',
      fr: 'Sistem proje kartını açmalı, satış/vergi/muhasebe/satış operasyon görevlerini üretmeli ve zorunlu doküman yükleme alanlarını göstermelidir.',
      int: 'Kontrat Yönetimi, SAP FI/CO ve e-posta/görev altyapısı ile proje başlangıç verisi ve görev bildirimleri senkronize edilmelidir.',
      kpi: 'Proje kaydı tamamlama süresi, eksik zorunlu alan oranı ve 15 gün içinde yüklenmeyen belge sayısı izlenir.',
      test: 'Zorunlu alan veya sözleşme eki eksikken süreç 0 tamamlanamamalı; ilgili ekip uyarısı üretilmelidir.',
    };
  }
  if (normalized.includes('teminat')) {
    return {
      br: 'Nihai teminat, alınan teminat, geçerlilik tarihi ve eksik teminat tutarı tutarlı olmadan teminat süreci tamamlandı sayılamaz.',
      fr: 'Sistem teminat türlerini, tutarları, geçerlilik tarihlerini, değerleme/ipotek belgelerini ve iade/güncelleme durumlarını takip etmelidir.',
      int: 'EBA Teminat süreci tetiklenmeli; EBA kapanışında nihai teminat bilgisi proje kartına geri yazılmalıdır.',
      kpi: 'Eksik teminat tutarı, teminat tamamlama süresi ve süresi yaklaşan/geçen teminat sayısı izlenir.',
      test: 'Beklenen teminat tutarı - Enerjisa’ya ulaşan teminat tutarı 0,00 TL olmadan süreç 1 %100 olamamalıdır.',
    };
  }
  if (normalized.includes('satinalma')) {
    return {
      br: 'Satınalma süreci, süreç 0 zorunlu alan ve belgeleri tamamlandıktan sonra başlatılmalıdır.',
      fr: 'Sistem satınalma talebini oluşturmalı, EBA/SAP sipariş bilgisini proje kartına bağlamalı ve tamamlanma durumunu izlemelidir.',
      int: 'Mevcut satınalma EBA akışı ve SAP satınalma/sipariş verisi ile çift yönlü durum güncellemesi yapılmalıdır.',
      kpi: 'Satınalma talebi açılış süresi, açık satınalma işi ve geciken satınalma görevi sayısı izlenir.',
      test: 'Süreç 0 tamamlanmadan satınalma akışı tetiklenmemeli; EBA kapanınca süreç 2 tamamlandı statüsüne geçmelidir.',
    };
  }
  if (normalized.includes('alt yuklenici')) {
    return {
      br: 'Alt yüklenici sözleşmesi, teminat, vekalet ve iş yeri teslim tutanağı tamamlanmadan kurulum ön koşulları sağlanmış kabul edilmemelidir.',
      fr: 'Sistem alt yüklenici evraklarını, zeyilleri, damga vergisi görevini, teminat bilgisini ve üç kademeli uyarı akışını yönetmelidir.',
      int: 'EBA, e-posta ve doküman yönetimi ile görev, evrak ve bildirim akışları izlenebilir olmalıdır.',
      kpi: 'Eksik alt yüklenici evrak oranı, açık görev yaşı ve hukuk eskalasyonuna düşen iş sayısı izlenir.',
      test: 'Zorunlu evrak eksikken süreç 3 kapanmamalı; gecikme halinde uzman, yönetici ve hukuk uyarı sırası çalışmalıdır.',
    };
  }
  if (normalized.includes('musteri')) {
    return {
      br: 'Proje tipi ve teknolojiye göre zorunlu müşteri izinleri, resmi başvuru belgeleri ve onay evrakları dinamik belirlenmelidir.',
      fr: 'Sistem çağrı mektubu, bağlantı anlaşması, GES uygunluk yazısı, proje onayı ve kabul başvurusu gibi belgeleri kategori bazlı toplamalıdır.',
      int: 'Doküman yönetimi ve gerekiyorsa resmi kurum/başvuru takip kayıtları proje süreciyle ilişkilendirilmelidir.',
      kpi: 'Müşteri evrak tamlık oranı, izin bekleme süresi ve eksik belge nedeniyle bloke proje sayısı izlenir.',
      test: 'Proje tipine göre zorunlu belge listesi tamamlanmadan süreç 4 %100 olamamalıdır.',
    };
  }
  if (normalized.includes('kurulum')) {
    return {
      br: 'Süreç 3 ve süreç 4 tamamlanmadan kurulum süreci aktif olmamalıdır; geciken milestone için neden alanı zorunlu olmalıdır.',
      fr: 'Sistem beklenen/gerçekleşen milestone tarihlerini, belge yükleme zorunluluklarını ve gecikme nedenlerini yönetmelidir.',
      int: 'Bildirim servisi ve doküman yönetimi, yaklaşan milestone ve zorunlu belge takipleriyle entegre çalışmalıdır.',
      kpi: 'Kurulum tamamlanma oranı, geciken milestone sayısı ve gecikme nedeni girilme oranı izlenir.',
      test: 'Gerçekleşme tarihi beklenen tarihten büyükse gecikme nedeni girilmeden kayıt ilerlememelidir.',
    };
  }
  if (normalized.includes('kabul')) {
    return {
      br: 'TEDAŞ geçici kabul, ENH kabulü, sistem kullanım anlaşması, güvence bedeli ve sigorta belgeleri tamamlanmadan kabul kapanmamalıdır.',
      fr: 'Sistem kabul belgelerini, tarih/numara bilgilerini, güvence bedeli durumunu ve tüm birimlere bildirim aksiyonunu yönetmelidir.',
      int: 'Dağıtım şirketi/SAP/doküman yönetimi kaynaklı kabul ve ödeme bilgileri proje kartına bağlanmalıdır.',
      kpi: 'Kabul belgesi tamlık oranı, kabul kapanış süresi ve kurulumdan kabule geçen süre izlenir.',
      test: 'TEDAŞ geçici kabul belgesi yüklenince kurulum oranı %100 olmalı; zorunlu kabul evrakı eksikken süreç 6 kapanmamalıdır.',
    };
  }
  if (normalized.includes('faturalama')) {
    return {
      br: 'Capex, Opex ve ödeme bildirimleri sözleşme süresi ve proje tipine göre izlenmeli; SAP ödeme/fatura bilgileriyle tutarlı olmalıdır.',
      fr: 'Sistem capex/opex fatura bilgilerini, ödeme bildirimlerini, açık tutarı ve ek fatura ihtiyacını proje bazında göstermelidir.',
      int: 'SAP fatura, ödeme ve açık tutar bilgileri otomatik alınmalı; birden fazla fatura ve dönemsel ödeme desteklenmelidir.',
      kpi: 'Fatura tamlık oranı, açık tutar, ödeme gecikmesi ve sözleşme süresine göre tamamlanma oranı izlenir.',
      test: 'Ödeme bildirim toplamı fatura toplamını aşarsa ilgili ekibe ek fatura uyarısı üretilmelidir.',
    };
  }
  if (normalized.includes('bakim')) {
    return {
      br: 'Bakım periyotları, yapılması gereken tarih, gerçekleşen tarih ve bakım kanıtları proje kartında takip edilmelidir.',
      fr: 'Sistem bakım planı, bakım formu, arıza/bulgu, yazışma/ihtarname ve aksiyon tarihi alanlarını desteklemelidir.',
      int: 'E-posta/bildirim ve doküman yönetimi, bakım hatırlatma ve delil dokümanı saklama için kullanılmalıdır.',
      kpi: 'Zamanında bakım oranı, geciken bakım sayısı ve bakım sonrası açık aksiyon sayısı izlenir.',
      test: 'Bakım tarihinden X gün önce bildirim gitmeli; gerçekleşen tarih gecikirse açıklama/aksiyon alanı zorunlu olmalıdır.',
    };
  }
  if (normalized.includes('hukuki') || normalized.includes('dava')) {
    return {
      br: 'Hukuki ihtilaf bulunan projeler liste, dashboard ve detay ekranlarında tek bakışta ayırt edilebilir olmalıdır.',
      fr: 'Sistem hukuki ikon, dava/ihtilaf durumu, hukuk evrakları, ihtarname/yazışma ve sorumlu hukuk aksiyonlarını göstermelidir.',
      int: 'Doküman yönetimi ve yetki servisi hukuki belge erişimi, audit log ve hassas içerik kontrolü için kullanılmalıdır.',
      kpi: 'Hukuki durum işaretli proje sayısı, açık hukuk aksiyon yaşı ve eksik hukuk evrak oranı izlenir.',
      test: 'Hukuki ihtilaf işaretli proje tüm liste/dashboard/detay ekranlarında tutarlı ikonla görünmelidir.',
    };
  }
  return {
    br: 'Süreç iş kuralı, rol, karar noktası ve operasyonel kısıtlar merkezi olarak yönetilmelidir.',
    fr: 'Kullanıcı veya sistem tetikleyicisiyle ilgili kayıt oluşturulmalı/güncellenmeli ve durum izlenmelidir.',
    int: 'İlgili entegrasyon güvenli servis, batch veya senkronizasyon katmanıyla çalışmalıdır.',
    kpi: 'Süreç başarı oranı, gecikme, hata oranı ve manuel müdahale ihtiyacı izlenir.',
    test: 'Pozitif, negatif, entegrasyon hata ve yetki testleri UAT kapsamına alınmalıdır.',
  };
}

function buildRequirementsTable(index: number, title = ''): string {
  const prefix = String(index).padStart(2, '0');
  const theme = requirementTheme(title);
  return [
    '| Gereklilik | Açıklama | Öncelik | Kabul Kriteri | KPI / Hedef |',
    '|---|---|---|---|---|',
    `| BR-${prefix}-01 | ${theme.br} | Yüksek | Kural ihlali durumunda işlem durdurulur veya kullanıcıya gerekçeli uyarı verilir. | Uyum oranı >= %99 |`,
    `| FR-${prefix}-01 | ${theme.fr} | Yüksek | Zorunlu alanlar, görevler ve belgeler tamamlanmadan süreç ilerlemez/kapanmaz. | Başarılı işlem oranı >= %95 |`,
    `| INT-${prefix}-01 | ${theme.int} | Yüksek | Başarılı/başarısız tüm entegrasyon çağrıları, kaynak kayıt ve hata nedeni ile izlenebilir. | Entegrasyon hata oranı <= %2 |`,
    `| NFR-${prefix}-01 | [VARSAYIM] Performans ve erişilebilirlik hedefleri operasyon hacmine uygun tasarlanır. | Orta | Kritik ekran/servis kabul edilen SLA içinde yanıt verir. | Yanıt süresi [AÇIK KONU] |`,
    `| UI-${prefix}-01 | [VARSAYIM] Kullanıcı ekranlarında açık validasyon, uyarı ve durum mesajları bulunur. | Orta | Hatalı veri kullanıcıya anlaşılır biçimde gösterilir. | Hatalı kayıt oranı azalır |`,
    `| RPT-${prefix}-01 | [VARSAYIM] Süreç durumu, hata ve bekleyen işler raporlanır. | Orta | Operasyon ekibi günlük raporda bekleyen/hatalı işleri görür. | Günlük rapor üretimi %100 |`,
    `| SEC-${prefix}-01 | [VARSAYIM] Rol bazlı yetki, audit log ve hassas veri koruması uygulanır. | Yüksek | Yetkisiz kullanıcı kritik işlem yapamaz. | Yetki ihlali 0 |`,
    `| KPI-${prefix}-01 | ${theme.kpi} | Orta | KPI panosu veya raporu ile ölçüm yapılır. | Manuel iş yükü ve gecikme azalır |`,
    `| TEST-${prefix}-01 | ${theme.test} | Yüksek | UAT kritik senaryoları başarıyla tamamlanır. | Kritik açık hata 0 |`,
    `| OPS-${prefix}-01 | [VARSAYIM] Retry, hata iş listesi ve operasyonel sorumluluk matrisi tanımlanır. | Orta | Hatalı kayıtlar takip edilebilir ve yeniden işlenebilir. | Açık hata SLA içinde kapanır |`,
  ].join('\n');
}

function buildProcessSpecificNotes(title: string): string {
  const normalized = normalizeForInference(title);
  const notes: Record<string, string[]> = {
    project: [
      '[VARSAYIM] Sözleşme imzalandıktan sonra proje kaydı açılır; proje adı, müşteri, santral tipi, güç/kapasite, bölge, deadline ve sorumlu ekipler zorunlu alan olarak takip edilir.',
      '[VARSAYIM] Proje kaydı açıldığında satış, vergi, muhasebe, satış operasyon, proje yönetimi ve kapsam ekiplerine görev/bildirim üretilir.',
      '[VARSAYIM] SAP tarafında proje kodu, kâr merkezi, bütçe ve maliyet kırılımı oluşmadan proje ilerleme statüsü tamamlandıya çekilemez.',
      '[VARSAYIM] Genel Dashboard ve proje bazlı Dashboard; statü, deadline, gecikme, kapasite ve açık görevleri görünür yapar.',
    ],
    guarantee: [
      '[VARSAYIM] Teminat süreci; kesin teminat mektubu, tutar, geçerlilik tarihi, müşteri onayı, revizyon ve iade adımlarını takip eder.',
      '[VARSAYIM] Eksik/hatalı teminat dokümanı varsa proje bir sonraki kritik aşamaya geçemez ve sorumlu role görev düşer.',
      '[VARSAYIM] EBA veya onay sistemi entegrasyonu varsa teminat onay sonucu proje kartına geri yazılır.',
    ],
    purchase: [
      '[VARSAYIM] Satınalma süreci; talep, teklif, sipariş, teslimat ve fatura ön koşullarını proje bazında izler.',
      '[VARSAYIM] Satınalma talebi EBA/SAP süreciyle açılır; sipariş numarası ve tedarikçi bilgisi proje kartına bağlanır.',
      '[VARSAYIM] Geciken satınalma işleri Dashboard üzerinde deadline ve sorumlu kişi bazında uyarı üretir.',
    ],
    subcontractor: [
      '[VARSAYIM] Alt yüklenici seçimi, sözleşme, yetki belgesi, teslim tutanağı, SGK/vergi evrakı ve teminat kontrolleriyle yönetilir.',
      '[VARSAYIM] Zorunlu evrak tamamlanmadan kurulum veya saha teslim adımı başlatılamaz.',
      '[VARSAYIM] Alt yüklenici performansı, açık iş, gecikme ve eksik doküman bilgileri raporlanır.',
    ],
    customer: [
      '[VARSAYIM] Müşteri işlemleri; çağrı mektubu, izinler, resmi başvurular, müşteri evrakları ve onay bekleyen aksiyonları kapsar.',
      '[VARSAYIM] Proje tipine göre zorunlu doküman listesi değişir ve eksik evrak proje bazlı takip edilir.',
      '[VARSAYIM] Müşteriye giden bildirimler, tarihçe ve belge versiyonları audit amaçlı saklanır.',
    ],
    installation: [
      '[VARSAYIM] Kurulum; saha hazırlık, ekip planlama, malzeme teslimi, gerçekleşen tarih, gecikme nedeni ve kapanış tutanağıyla izlenir.',
      '[VARSAYIM] Satınalma ve müşteri evrakı tamamlanmadan kurulum görevi başlatılmaz.',
      '[VARSAYIM] Kurulum ilerlemesi proje bazlı Dashboard üzerinde yüzde, tarih ve sorumlu ekip kırılımıyla gösterilir.',
    ],
    acceptance: [
      '[VARSAYIM] GES kabul süreci; TEDAŞ/geçici kabul, sistem kullanım anlaşması, sigorta, garanti bedeli ve resmi onay dokümanlarını takip eder.',
      '[VARSAYIM] Kabul evrakı eksikse faturalama veya kapanış süreci bloklanır.',
      '[VARSAYIM] Kabul statüleri tarihçe, sorumlu kurum ve bekleyen aksiyon bazında raporlanır.',
    ],
    billing: [
      '[VARSAYIM] Faturalama süreci SAP belge akışına bağlıdır; capex/opex kırılımı, fatura tipi, tutar, kalan açık tutar ve ödeme durumu izlenir.',
      '[VARSAYIM] Ek fatura veya eksik belge durumunda ilgili ekip ve müşteriye bildirim/e-posta aksiyonu üretilir.',
      '[VARSAYIM] SAP fatura numarası ve muhasebe durumu proje kartına yazılmadan finansal kapanış tamamlanamaz.',
    ],
    maintenance: [
      '[VARSAYIM] Bakım süreci; planlı bakım periyodu, gerçekleşen bakım tarihi, ekip, bakım formu, arıza/bulgu ve müşteri onayıyla takip edilir.',
      '[VARSAYIM] Yaklaşan bakım tarihleri için otomatik görev ve hatırlatma oluşturulur.',
      '[VARSAYIM] Bakım geçmişi proje kartında ve raporlarda cihaz/saha/müşteri bazında görüntülenir.',
    ],
    legal: [
      '[VARSAYIM] Hukuki durum süreci; dava, ihtilaf, ihtarname, yazışma, sorumlu hukuk ekibi ve aksiyon tarihlerini proje kartı üzerinde görünür hale getirir.',
      '[VARSAYIM] Hukuki ihtilaf bulunan projeler liste, dashboard ve proje detay ekranlarında standart ikon ile işaretlenir.',
      '[VARSAYIM] Hukuki evraklar yetki kontrollü doküman kategorisi altında saklanır; erişim, görüntüleme ve indirme audit log kapsamına alınır.',
    ],
  };

  const selected = normalized.includes('proje kayd') ? notes.project
    : normalized.includes('teminat') ? notes.guarantee
      : normalized.includes('satinalma') ? notes.purchase
        : normalized.includes('alt yuklenici') ? notes.subcontractor
          : normalized.includes('musteri') ? notes.customer
            : normalized.includes('kurulum') ? notes.installation
              : normalized.includes('kabul') ? notes.acceptance
                : normalized.includes('faturalama') ? notes.billing
                  : normalized.includes('bakim') ? notes.maintenance
                    : normalized.includes('hukuki') || normalized.includes('dava') ? notes.legal
                    : [];

  if (!selected.length) {
    return '- [VARSAYIM] Sürece özgü ekran, görev, belge, entegrasyon ve raporlama kuralları detay tasarımda netleştirilecektir.';
  }
  return selected.map(item => `- ${item}`).join('\n');
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

### Sürece Özgü İş Kuralları, Ekranlar ve Dokümanlar
${buildProcessSpecificNotes(title)}

### İş Gerekleri ve KPIs
${buildRequirementsTable(index, title)}

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

function buildFallbackTemplate(sourceContent: string, inferenceContent = sourceContent): string {
  if (isPartiallyStructuredConceptualDraft(sourceContent)) {
    return completePartialConceptualDraft(sourceContent, inferenceContent);
  }

  const projectName = inferProjectName(inferenceContent);
  const today = new Date().toLocaleDateString('tr-TR');
  const sourceAnchoredProjectTracking = isProjectTrackingRequest(inferenceContent);
  const existingProcessTitles = sourceAnchoredProjectTracking
    ? extractProcessModelTitles(sourceContent).filter(title => !isGenericIntegrationProcessTitle(title))
    : extractProcessModelTitles(sourceContent);
  const existingProcessCount = countProcessModels(sourceContent);
  const inferredProcessModels = inferProcessModels(inferenceContent);
  const targetProcessCount = Math.max(
    expectedProcessCount(inferenceContent),
    existingProcessTitles.length,
    inferredProcessModels.length,
  );
  const processModels = sourceAnchoredProjectTracking
    ? inferredProcessModels.slice(0, targetProcessCount)
    : mergeProcessModelTitles(existingProcessTitles, inferredProcessModels, targetProcessCount);
  const processToc = processModels
    .map((title, index) => `- ${index + 1}. SÜREÇ MODELİ - ${index + 1} "${title}"`)
    .join('\n');
  const trustedExistingProcessCount = sourceAnchoredProjectTracking ? 0 : existingProcessCount;
  const missingProcessModels = trustedExistingProcessCount >= targetProcessCount
    ? []
    : processModels
      .filter(title => !existingProcessTitles.some(existing => normalizeForInference(existing) === normalizeForInference(title)))
      .slice(0, targetProcessCount - trustedExistingProcessCount);
  const processBlocks = missingProcessModels
    .map((title, index) => buildProcessModelBlock(title, trustedExistingProcessCount + index + 1))
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

${processBlocks ? `\n${processBlocks}` : ''}

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

export function ensureConceptualTemplateStructure(document: DocumentData, sourceContext = ''): DocumentData {
  const businessAnalysis = document.businessAnalysis;
  const content = businessAnalysis?.content || '';
  const inferenceContent = [sourceContext, content].filter(Boolean).join('\n\n');
  if (!content.trim() || isConceptualTemplateCompliant(content) || isRichConceptualDraft(content)) {
    if (!shouldRebuildFromSource(content, sourceContext)) {
      return document;
    }
  }

  if (shouldRebuildFromSource(content, sourceContext)) {
    const stripped = stripProcessModelBlocks(content);
    return {
      ...document,
      businessAnalysis: {
        content: buildFallbackTemplate(stripped || content, inferenceContent),
        status: businessAnalysis?.status || 'DRAFT',
        flags: addFlag(businessAnalysis?.flags, 'SOURCE_ANCHORED_TEMPLATE_REBUILT'),
      },
    };
  }

  if (isPartiallyStructuredConceptualDraft(content)) {
    return {
      ...document,
      businessAnalysis: {
        content: completePartialConceptualDraft(content, inferenceContent),
        status: businessAnalysis?.status || 'DRAFT',
        flags: addFlag(businessAnalysis?.flags, 'CONCEPTUAL_TEMPLATE_COMPLETED'),
      },
    };
  }

  return {
    ...document,
    businessAnalysis: {
      content: buildFallbackTemplate(content, inferenceContent),
      status: businessAnalysis?.status || 'DRAFT',
      flags: addFlag(businessAnalysis?.flags, 'CONCEPTUAL_TEMPLATE_APPLIED'),
    },
  };
}
