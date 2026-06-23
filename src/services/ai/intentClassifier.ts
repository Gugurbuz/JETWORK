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

function sparseDiscoveryQuestions(normalized: string): string[] {
  if (/sap\s*crm/.test(normalized) && /(iys|ileti yonetim sistemi)/.test(normalized)) {
    return [
      'İYS entegrasyonunda hedef kapsam hangi izin kanallarını kapsıyor: SMS, e-posta, arama ve/veya çoklu marka?',
      'SAP CRM tarafında izin verisi hangi nesne ve alanlarda tutuluyor; mevcut veri kalitesi ve telefon/e-posta formatı ne durumda?',
      'Senkronizasyon modeli nasıl olmalı: anlık API, batch/delta mutabakat, initial load ve retry/kuyruk ihtiyacı var mı?',
      'Yasal uyum ve operasyon için başarı hangi KPI ve kontrollerle ölçülecek: 3 iş günü kuralı, ret sonrası durdurma, log/audit, hata raporu?',
    ];
  }

  if (/sap\s*crm/.test(normalized) && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|sales)/.test(normalized)) {
    return [
      'AI satış botu hangi kanallarda çalışacak ve birincil kullanıcı kim olacak: müşteri, satış temsilcisi, bayi, çağrı merkezi veya iç ekip?',
      'SAP CRM tarafında bot hangi nesneleri okuyup/yazacak: Lead, Opportunity, Activity, Business Partner, teklif, sipariş veya kampanya?',
      'Botun karar yetkisi nerede bitecek; hangi durumlarda insan satış temsilcisine devredecek ve onay akışı gerekecek?',
      'Başarı KPI’ları ve risk sınırları neler olacak: lead dönüşüm oranı, yanıt süresi, veri doğruluğu, KVKK/onay, hatalı öneri toleransı?',
    ];
  }

  return [
    'Çözmek istediğimiz ana iş problemi ve hedef kullanıcı grubu nedir?',
    'Mevcut süreç veya sistemde bugün hangi ağrı noktaları var?',
    'İlk sürümde kesinlikle olması gereken fonksiyonlar ve kapsam dışı kalacak alanlar neler?',
    'Başarıyı hangi KPI, kabul kriteri veya iş değeriyle ölçeceğiz?',
  ];
}

function classifySparseInitialDomainDiscovery(input: ClassifyInput): IntentClassification | null {
  if (hasDocumentContent(input.document)) return null;

  const normalized = normalizeForDiscovery(input.userMessage);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const isSapCrmDomain = /sap\s*crm/.test(normalized)
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|sales|iys|ileti yonetim sistemi)/.test(normalized);
  const asksForDocumentOutput = /(ba analiz|is analiz|kavramsal|tasarim|dokuman|rapor|brd|fdd|hazirla|olustur|uret|yaz)/.test(normalized);
  const explicitlyAllowsDraft = /(varsayimlarla|soru sorma|bu bilgilerle|mevcut bilgilerle|hizli taslak|ilk taslagi|sen yap|direkt olustur|direkt hazirla)/.test(normalized);

  if (!isSapCrmDomain || !asksForDocumentOutput || explicitlyAllowsDraft || tokenCount > 14) {
    return null;
  }

  return buildClassification('generate_business_analysis', {
    targetSection: 'businessAnalysis',
    operation: 'none',
    documentImpact: 'none',
    confidence: 0.9,
    riskLevel: 'medium',
    requiresClarification: true,
    clarificationQuestions: sparseDiscoveryQuestions(normalized),
    requiresPreview: false,
    shouldRunBaAgentLoop: false,
    baAgentFocus: 'business_analysis',
    reason: 'deterministic:sparse_initial_domain_discovery_before_document',
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
