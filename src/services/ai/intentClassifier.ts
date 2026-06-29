import { Type } from '@google/genai';
import { callGemini, callAiWithRetry } from '../geminiService';
import { DocumentData } from '../../types';
import {
  IntentClassification,
  SubIntent,
  PRIMARY_BY_SUB,
  INTENT_DEFAULTS,
  ALL_SUB_INTENTS,
  SLASH_COMMAND_MAP,
  DocumentSectionKey,
} from './intentTypes';

const SECTION_ENUM = ['businessAnalysis', 'code', 'test', 'bpmn', 'review'];

const classifierSchema = {
  type: Type.OBJECT,
  properties: {
    subIntent: { type: Type.STRING, enum: [...ALL_SUB_INTENTS] },
    targetSection: { type: Type.STRING, enum: SECTION_ENUM },
    secondaryTargetSection: { type: Type.STRING, enum: SECTION_ENUM },
    operation: { type: Type.STRING },
    documentImpact: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    riskLevel: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
    requiresResearch: { type: Type.BOOLEAN },
    researchType: { type: Type.STRING, enum: ['internal', 'web', 'uploaded_files', 'workspace_history'] },
    requiresClarification: { type: Type.BOOLEAN },
    clarificationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    requiresPreview: { type: Type.BOOLEAN },
    shouldRunBaAgentLoop: { type: Type.BOOLEAN },
    baAgentFocus: { type: Type.STRING, enum: ['business_analysis', 'technical_analysis', 'test', 'flow', 'review', 'quality'] },
    reason: { type: Type.STRING },
  },
  required: ['subIntent', 'confidence', 'riskLevel', 'reason'],
};

const SYSTEM_PROMPT = `Sen JETWORK Intent Classifier katmanısın. Görevin kullanıcı mesajını ürün aksiyonuna çevirmektir.
Görünür çok ajan tartışması başlatma. Zero-Touch MVP'de kapalıdır.
Sadece geçerli JSON döndür. Markdown, açıklama veya serbest metin yazma.

KURALLAR:
- Sadece açıklama isteniyorsa documentImpact = 'none'.
- Dokümana ekle/yaz/güncelle/çıkar/hazırla deniyorsa uygun targetSection belirle.
- Seçili metin varsa "bunu/şunu" önce selectedText'e bağlanır.
- Silme, komple baştan yazma, restore gibi riskli işlemlerde requiresPreview = true.
- Emin değilsen requiresClarification = true yap; doküman güncelleme önerme.
- Bilinmeyen kurumsal bilgi varsa uydurma; assumption/open question üret.
- Kullanıcı bir talep/fikir/entegrasyon anlatıyorsa ve boş dokümana yazılacaksa -> generate_business_analysis (analysis_generation).
- "araştır / güncel bilgi / best practice" açıkça geçiyorsa research_* intentleri kullan.
- /ekip -> zero_touch_requested.

ÖNEMLİ: Yanıt yalnızca şu JSON: { subIntent, targetSection, secondaryTargetSection, operation, documentImpact, confidence (0-1), riskLevel, requiresResearch, researchType, requiresClarification, clarificationQuestions, requiresPreview, shouldRunBaAgentLoop, baAgentFocus, reason }.`;

function docSummary(doc: DocumentData | null): string {
  if (!doc) return 'boş';
  const parts = Object.entries(doc as any)
    .filter(([, v]: [string, any]) => v?.content)
    .map(([k, v]: [string, any]) => `${k}:${v.status || 'DRAFT'}(${String(v.content).length}c)`);
  return parts.length > 0 ? parts.join('; ') : 'boş';
}

function parseSlashCommand(msg: string): IntentClassification | null {
  const trimmed = msg.trim();
  if (!trimmed.startsWith('/')) return null;
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  const map = SLASH_COMMAND_MAP[first];
  if (!map) {
    return buildClassification('invalid_command', { reason: `Bilinmeyen komut: ${first}` });
  }
  return buildClassification(map.sub, { targetSection: map.target, reason: `Slash command: ${first}` });
}

export function buildClassification(
  sub: SubIntent,
  overrides: Partial<IntentClassification> = {}
): IntentClassification {
  const defaults = INTENT_DEFAULTS[sub] || { impact: 'none' as const, operation: 'none' as const, risk: 'low' as const };
  const primary = PRIMARY_BY_SUB[sub];
  return {
    primaryIntent: primary,
    subIntent: sub,
    targetSection: overrides.targetSection ?? defaults.targetSection,
    secondaryTargetSection: overrides.secondaryTargetSection,
    operation: overrides.operation ?? defaults.operation,
    documentImpact: overrides.documentImpact ?? defaults.impact,
    confidence: overrides.confidence ?? 0.7,
    riskLevel: overrides.riskLevel ?? defaults.risk,
    requiresResearch: overrides.requiresResearch ?? false,
    researchType: overrides.researchType,
    requiresClarification: overrides.requiresClarification ?? false,
    clarificationQuestions: overrides.clarificationQuestions,
    requiresPreview: overrides.requiresPreview ?? (defaults.risk === 'high'),
    shouldRunBaAgentLoop: overrides.shouldRunBaAgentLoop ?? !!defaults.shouldRunBaAgentLoop,
    baAgentFocus: overrides.baAgentFocus ?? defaults.baAgentFocus,
    reason: overrides.reason ?? `Default mapping for ${sub}`,
  };
}

export interface ClassifyInput {
  userMessage: string;
  document: DocumentData | null;
  selectedText?: string | null;
  selectedSection?: DocumentSectionKey | null;
  model: string;
}

function normalizeForDiscovery(value: string): string {
  return (value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function hasDocumentContent(doc: DocumentData | null): boolean {
  if (!doc) return false;
  return Object.values(doc as any).some((section: any) => section?.content && String(section.content).trim().length > 0);
}

function inferSparseSubject(message: string): string {
  const cleaned = message
    .replace(/\b(kavramsal|tasarım|tasarim|dokümanı|dokumani|doküman|dokuman|rapor|ba analiz|iş analiz|is analiz|hazırla|hazirla|oluştur|olustur|üret|uret|yazalım|yazalim|yaz)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length >= 8 && cleaned.length <= 90) return cleaned;
  return 'bu proje';
}

function withOptions(question: string, options: string[]): string {
  return [
    question,
    `Seçenekler: ${options.join(' | ')}`,
  ].join('\n');
}

function sparseDiscoveryQuestions(normalized: string, userMessage = ''): string[] {
  if (/sap\s*crm/.test(normalized) && /(iys|ileti yonetim sistemi)/.test(normalized)) {
    return [
      withOptions('İYS entegrasyonunda hedef kapsam hangi izin kanallarını kapsıyor?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayımla tüm kanallar']),
      withOptions('SAP CRM / C4C tarafında izin verisi hangi nesne ve alanlarda tutuluyor?', ['Business Partner izin alanları', 'C4C marketing permission objeleri', 'Açık konu: mevcut alanlar teyit edilecek']),
      withOptions('Senkronizasyon modeli nasıl olmalı?', ['Initial load + günlük delta', 'Anlık API + batch mutabakat', 'Varsayımla hibrit model']),
      withOptions('Yasal uyum ve operasyon için başarı hangi KPI ve kontrollerle ölçülecek?', ['3 iş günü uyum + ret durdurma', 'Log/audit + hata raporu', 'Varsayımla tam kontrol seti']),
    ];
  }

  if (/sap\s*crm/.test(normalized) && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|sales)/.test(normalized)) {
    return [
      withOptions('AI satış botu hangi kanallarda çalışacak?', ['Web chat + WhatsApp', 'SAP CRM içinde temsilci asistanı', 'Varsayımla çoklu kanal']),
      withOptions('SAP CRM tarafında bot hangi nesneleri okuyup/yazacak?', ['Lead + Opportunity + Activity', 'Sadece lead oluşturma', 'Varsayımla lead ve opportunity kapsamda']),
      withOptions('Botun karar yetkisi nerede bitecek?', ['Sadece öneri ve özet', 'Lead nitelendirme + CRM kaydı', 'Varsayımla kritik işlemler temsilci onaylı']),
      withOptions('Hangi durumda insan satış temsilcisine devir ve kalite kontrol gerekecek?', ['Düşük güvende temsilciye devir', 'Tüm satış aksiyonları onaylı', 'Varsayımla risk bazlı devir modeli']),
    ];
  }

  if (/(d2d|door to door|saha satis|saha uygulamasi|mobil donusum|mobile donusum|refactoring|refaktoring)/.test(normalized)) {
    return [
      withOptions('Mobil dönüşümde ilk sürüm hangi saha satış kapsamını içermeli?', ['Rota + ziyaret + müşteri adayı', 'Teklif/sipariş + evrak + imza', 'Varsayımla uçtan uca saha akışı']),
      withOptions('Saha uygulamasında offline çalışma ihtiyacı nasıl ele alınmalı?', ['Offline-first zorunlu', 'Sadece sınırlı offline kayıt', 'Varsayımla offline-first + delta sync']),
      withOptions('Merkez sistemlerle entegrasyon hangi öncelikte tasarlansın?', ['SAP/C4C müşteri ve lead', 'Sipariş + doküman + onay servisleri', 'Varsayımla tüm kritik servisler']),
      withOptions('Saha temsilcisi ekranlarında hangi davranış kuralları kritik?', ['Hızlı veri girişi + toast validasyon', 'GPS/fotoğraf/imza zorunlulukları', 'Varsayımla saha odaklı UX kuralları']),
    ];
  }

  const subject = inferSparseSubject(userMessage);
  const isTransformation = /(donusum|refactoring|refaktoring|modernizasyon|yenileme|migration|gecis)/.test(normalized);
  const isProductOrApp = /(uygulama|platform|portal|ekran|mobile|mobil|web|app|sistem)/.test(normalized);
  const isWorkflowHeavy = /(surec|onay|akis|operasyon|is akisi)/.test(normalized);
  const scopeOptions = isTransformation
    ? ['As-Is sorunlar + To-Be hedef yapı', 'Kademeli refactoring yol haritası', 'Varsayımla dönüşüm + sürdürülebilirlik']
    : isProductOrApp
      ? ['Ekranlar + kullanıcı yolculuğu', 'MVP kapsam + sonraki fazlar', 'Varsayımla uçtan uca ürün deneyimi']
      : ['Mevcut süreci iyileştirme', 'Yeni uçtan uca çözüm tasarımı', 'Varsayımla iş değeri + uygulanabilir kapsam'];
  const behaviorOptions = isWorkflowHeavy
    ? ['Süreç adımları + karar noktaları', 'Onay/görev/bildirim kuralları', 'Varsayımla süreç + kontrol matrisi']
    : ['Ekranlar + validasyon + bildirimler', 'Veri + entegrasyon + iş kuralları', 'Varsayımla tüm kritik davranışlar'];

  return [
    withOptions(`"${subject}" için ana iş problemi ve hedef iş değeri nedir?`, scopeOptions),
    withOptions('Kavramsal tasarımda hangi kullanıcı rolleri ve süreç adımları görünmeli?', ['Operasyonel kullanıcı + yönetici', 'Müşteri/kullanıcı + iç ekipler', 'Varsayımla rol bazlı uçtan uca akış']),
    withOptions('Uygulamanın/sistemin davranış kuralları hangi başlıklarda detaylanmalı?', behaviorOptions),
    withOptions('Başarı, risk ve kabul kriterleri hangi çerçevede yazılsın?', ['KPI + UAT + operasyon kontrolü', 'Risk + açık konu + onay matrisi', 'Varsayımla tam BA kalite çerçevesi']),
  ];
}

function classifySparseInitialDomainDiscovery(input: ClassifyInput): IntentClassification | null {
  if (hasDocumentContent(input.document)) return null;

  const normalized = normalizeForDiscovery(input.userMessage);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasProjectSignal = /(proje|uygulama|platform|portal|sistem|surec|donusum|refactoring|refaktoring|entegrasyon|bot|asistan|assistant|crm|sap|iys|mobil|mobile|d2d|dokuman yonetimi|sozlesme)/.test(normalized);
  const asksForDocumentOutput = /(ba analiz|is analiz|kavramsal|tasarim|dokuman|rapor|brd|fdd|hazirla|olustur|uret|yaz)/.test(normalized);
  const hasRealDiscoveryDetail = [
    /(problem|ihtiyac|hedef|kpi|basari|deger)/,
    /(rol|kullanici|paydas|musteri|operasyon|yonetici)/,
    /(as-is|to-be|mevcut|hedeflenen|surec adim)/,
    /(ekran|validasyon|bildirim|toast|onay|gorev)/,
    /(veri|entegrasyon|api|servis|middleware|rapor|dashboard)/,
  ].filter((pattern) => pattern.test(normalized)).length;
  const explicitlyAllowsDraft = /(varsayimlarla|soru sorma|bu bilgilerle|mevcut bilgilerle|hizli taslak|ilk taslagi|sen yap|direkt olustur|direkt hazirla)/.test(normalized);

  if (!hasProjectSignal || !asksForDocumentOutput || explicitlyAllowsDraft || tokenCount > 18 || hasRealDiscoveryDetail >= 2) {
    return null;
  }

  return buildClassification('generate_business_analysis', {
    targetSection: 'businessAnalysis',
    operation: 'none',
    documentImpact: 'none',
    confidence: 0.9,
    riskLevel: 'medium',
    requiresClarification: true,
    clarificationQuestions: sparseDiscoveryQuestions(normalized, input.userMessage),
    requiresPreview: false,
    shouldRunBaAgentLoop: false,
    baAgentFocus: 'business_analysis',
    reason: 'deterministic:sparse_initial_project_discovery_before_document',
  });
}

export async function classifyIntent(input: ClassifyInput): Promise<IntentClassification> {
  const slash = parseSlashCommand(input.userMessage);
  if (slash) return slash;

  const sparseDiscovery = classifySparseInitialDomainDiscovery(input);
  if (sparseDiscovery) return sparseDiscovery;

  const selection = input.selectedText
    ? `\n[SEÇİLİ METİN (${input.selectedSection || '?'})]\n"""${String(input.selectedText).slice(0, 400)}"""`
    : '';

  const prompt = `[DOKÜMAN DURUMU] ${docSummary(input.document)}${selection}\n\n[KULLANICI MESAJI]\n${input.userMessage}\n\nJSON ile cevapla.`;

  try {
    const res = await callAiWithRetry(() =>
      callGemini({
        model: input.model,
        systemInstruction: SYSTEM_PROMPT,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: classifierSchema,
        onChunk: () => {},
      })
    );
    const raw = (res.text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(raw) as Partial<IntentClassification>;
    const sub = (parsed.subIntent && PRIMARY_BY_SUB[parsed.subIntent as SubIntent])
      ? (parsed.subIntent as SubIntent)
      : fallbackSubIntent(input);
    const classification = buildClassification(sub, {
      targetSection: (parsed.targetSection && String(parsed.targetSection).trim() ? parsed.targetSection : undefined) as DocumentSectionKey | undefined,
      secondaryTargetSection: (parsed.secondaryTargetSection && String(parsed.secondaryTargetSection).trim() ? parsed.secondaryTargetSection : undefined) as DocumentSectionKey | undefined,
      operation: parsed.operation,
      documentImpact: parsed.documentImpact,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.65,
      riskLevel: parsed.riskLevel,
      requiresResearch: parsed.requiresResearch,
      researchType: parsed.researchType,
      requiresClarification: parsed.requiresClarification,
      clarificationQuestions: parsed.clarificationQuestions,
      requiresPreview: parsed.requiresPreview,
      shouldRunBaAgentLoop: parsed.shouldRunBaAgentLoop,
      baAgentFocus: parsed.baAgentFocus,
      reason: parsed.reason || 'classifier',
    });
    return classification;
  } catch (e) {
    console.warn('Intent classifier failed, using heuristic fallback:', e);
    return buildClassification(fallbackSubIntent(input), { confidence: 0.45, reason: 'classifier_fallback' });
  }
}

function fallbackSubIntent(input: ClassifyInput): SubIntent {
  const msg = input.userMessage.trim().toLowerCase();
  const hasDoc = !!(input.document && Object.values(input.document).some((s: any) => s?.content));

  if (msg.length < 30 && /(selam|merhaba|hi|nasılsın|naber)/i.test(msg)) return 'small_talk';
  if (input.selectedText && /(bunu|şunu|burayı)/i.test(msg) && /(açıkla|anlat)/i.test(msg)) return 'explain_selected_text';
  if (input.selectedText && /(bunu|şunu|burayı)/i.test(msg)) return 'improve_selected_text';
  if (/(test|kabul kriter|uat)/i.test(msg)) return 'generate_test_cases';
  if (/(akış|bpmn|mermaid|flow|süreç)/i.test(msg)) return 'generate_flow_diagram';
  if (/(risk|eksik|review|kalite|inceleme)/i.test(msg)) return 'find_risks';
  if (/(araştır|best practice|güncel|standart)/i.test(msg)) return 'research_web';
  if (/(indir|export|paylaş|versiyon)/i.test(msg)) return 'export_document';
  if (/(nedir|açıkla|anlat|nasıl kullan)/i.test(msg) && msg.length < 80) return 'ask_explanation';
  if (hasDoc) return 'add_requirement_detail';
  return 'generate_business_analysis';
}
