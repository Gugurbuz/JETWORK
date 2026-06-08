import { DocumentData, Message } from '../../types';
import { buildBaDiscoveryState, isLikelyBaDiscoveryAnswer } from '../../modules/ai-ba-engine';

export interface DiscoverySignals {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
  answeredQuestionCount: number;
  questionRoundCount: number;
  documentReadinessScore: number;
  baDiscoveryReadiness: number;
  missingDiscoveryFields: string[];
  isAnsweringDiscovery: boolean;
  mustGenerateNow: boolean;
  reason: string;
}

const FORCE_GENERATE_PATTERNS: RegExp[] = [
  /\bevet[,\s!.?]*\s*(başlayalım|başla|başlayabilirsin|devam|ilerleyelim|ilerle|olsun|tabii)/i,
  /\bbaşlayalım\b/i,
  /\bbaşla(?:sın|lım|yalım)?\b/i,
  /\bhaydi\b/i,
  /\bhadi\b/i,
  /\bfdd('?yi|.?yi)?\s*(hazırla|başlat|oluştur|üret|yaz)/i,
  /\bfdd\s*başlasın\b/i,
  /\b(dokümanı|dokumanı|doküman|dokuman)\s*(oluştur|üret|hazırla|yaz|başlat)/i,
  /\b(analiz(?:i|e)?)\s*(geç|başla|oluştur|hazırla|üret|yaz)/i,
  /\bba\s*(analiz(?:i|e)?)\s*(oluştur|hazırla|yaz|üret)/i,
  /\bbu\s+bilgilerle\s+(ilerle|devam|oluştur|yaz|hazırla)/i,
  /\bvarsayımlarla\s+(devam|ilerle|oluştur|hazırla)/i,
  /\bmevcut\s+bilgilerle\b/i,
  /\btaslak\s*(oluştur|çıkar|hazırla|yaz)/i,
  /\btamam[,\s!.?]*\s*(oluştur|yaz|hazırla|başla|başlayalım)/i,
  /\buygula\b/i,
];

const STOP_QUESTION_PATTERNS: RegExp[] = [
  /\byeter\s*(artık)?\b/i,
  /\bdaha\s*(fazla)?\s*soru\s*sorma\b/i,
  /\bsoru\s*(yeter|kes|durdur|sorma)\b/i,
  /\bsorulardan\s+bıktım\b/i,
];

const GREETING_PATTERNS: RegExp[] = [
  /^\s*(selam(lar)?|slm|mrb|mrhb|merhaba|merhabalar|hey|hi|hello|hola|naber|nbr|nasılsın|nasilsin|ne haber|günaydın|gunaydin|iyi akşamlar|iyi geceler|kolay gelsin|selamün aleyküm|selamunaleykum)\s*[!?.,]*\s*$/i,
];

const GREETING_TOKENS = [
  'mrb', 'mrhb', 'merhaba', 'merhabalar',
  'selam', 'selamlar', 'slm',
  'hey', 'hi', 'hello', 'hola',
  'naber', 'nbr', 'nasılsın', 'nasilsin',
  'günaydın', 'gunaydin',
];

const SMALL_TALK_CORRECTION_PATTERNS: RegExp[] = [
  /\b(selam|naber|mrb|slm|merhaba|hey)\b.*\b(dedim|yazdım|yazdim|söyledim|soyledim|verdim)\b/i,
  /\bsadece\s+(selam|naber|mrb|slm|merhaba|hey)\b/i,
  /\bne\s+sorusu\s*ya?\b/i,
  /\bneden\s+soru\s+soruyorsun\b/i,
  /\bsoru\s+sorma\s+sadece\b/i,
  /\bben\s+sana\s+(selam|naber|mrb|slm|merhaba|hey)\b/i,
];

function normalizeTr(input: string): string {
  return (input || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function isGreetingLike(message: string): boolean {
  const normalized = normalizeTr(message);
  if (!normalized) return false;
  if (GREETING_PATTERNS.some((re) => re.test(message))) return true;
  if (SMALL_TALK_CORRECTION_PATTERNS.some((re) => re.test(message))) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const hasGreetingToken = tokens.some((t) => GREETING_TOKENS.includes(t));
  if (!hasGreetingToken) return false;
  return tokens.length <= 6;
}

const BLOCKED_QUESTION_TERMS: string[] = [
  'iş arıyorum',
  'is ariyorum',
  'eleman arıyorum',
  'yetenek arıyorum',
  'aday arıyorum',
  'freelance',
  'tam zamanlı',
  'yarı zamanlı',
  'remote',
  'hibrit',
  'işveren',
  'isveren',
  'job',
  'talent',
  'recruit',
  'cv yükle',
];

export function containsBlockedQuestionDomain(
  questions: Array<{ text?: string; options?: string[] }> | undefined | null
): boolean {
  if (!questions || questions.length === 0) return false;
  const text = JSON.stringify(questions).toLocaleLowerCase('tr-TR');
  return BLOCKED_QUESTION_TERMS.some((term) => text.includes(term));
}

export function detectSignals(userMessage: string): {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
} {
  const msg = (userMessage || '').trim();
  return {
    forceGenerate: FORCE_GENERATE_PATTERNS.some((re) => re.test(msg)),
    stopQuestions: STOP_QUESTION_PATTERNS.some((re) => re.test(msg)),
    greetingOnly: isGreetingLike(msg),
  };
}

const getSender = (message: Message): string => String((message as any).sender || message.role || '').toLowerCase();

function countQuestionRounds(messages: Message[]): number {
  return messages.filter((m) => getSender(m) === 'ai' || getSender(m) === 'model')
    .filter((m) => Array.isArray((m as any).questions) && (m as any).questions.length > 0)
    .length;
}

function countAnsweredQuestions(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    if (getSender(m) === 'user' && typeof m.text === 'string') {
      const markerMatches = m.text.match(/\*\*Soru\s+\d+:\*\*/g);
      const answerMatches = m.text.match(/\bCevap\s*:/gi);
      total += Math.max(markerMatches?.length || 0, answerMatches?.length || 0);
    }
  }
  return total;
}

function scoreDocumentReadiness(document: DocumentData | null, history: Message[]): number {
  const discovery = buildBaDiscoveryState({ document, messages: history });
  let lengthScore = 0;
  if (document) {
    const ba = String((document as any).businessAnalysis?.content || '');
    const review = String((document as any).review?.content || '');
    if (ba.length > 200) lengthScore += 20;
    if (ba.length > 800) lengthScore += 15;
    if (ba.length > 2500) lengthScore += 15;
    if (review.length > 100) lengthScore += 10;
  }
  return Math.min(100, Math.max(discovery.readinessScore, lengthScore));
}

export function computeDiscoverySignals(
  userMessage: string,
  messages: Message[],
  document: DocumentData | null
): DiscoverySignals {
  const { forceGenerate, stopQuestions, greetingOnly } = detectSignals(userMessage);
  const discovery = buildBaDiscoveryState({ userMessage, messages, document });
  const questionRoundCount = countQuestionRounds(messages);
  const answeredQuestionCount = Math.max(countAnsweredQuestions(messages), discovery.answeredQuestionCount);
  const documentReadinessScore = scoreDocumentReadiness(document, messages);
  const isAnsweringDiscovery = isLikelyBaDiscoveryAnswer(userMessage);

  let reason = '';
  let mustGenerateNow = false;

  if (forceGenerate) {
    mustGenerateNow = true;
    reason = 'user_force_generate';
  } else if (stopQuestions) {
    mustGenerateNow = true;
    reason = 'user_stop_questions';
  } else if (isAnsweringDiscovery && (answeredQuestionCount >= 1 || questionRoundCount > 0)) {
    mustGenerateNow = true;
    reason = 'user_answered_discovery_questions';
  } else if (answeredQuestionCount >= 6) {
    mustGenerateNow = true;
    reason = 'enough_answers_collected';
  } else if (questionRoundCount >= 2) {
    mustGenerateNow = true;
    reason = 'question_round_cap_reached';
  } else if (documentReadinessScore >= 60) {
    mustGenerateNow = true;
    reason = 'document_readiness_threshold';
  }

  return {
    forceGenerate,
    stopQuestions,
    greetingOnly,
    answeredQuestionCount,
    questionRoundCount,
    documentReadinessScore,
    baDiscoveryReadiness: discovery.readinessScore,
    missingDiscoveryFields: discovery.missingFields.map((field) => field.label),
    isAnsweringDiscovery,
    mustGenerateNow,
    reason,
  };
}

export const DOMAIN_LOCK_RULE = `ÜRÜN TANIMI (ZORUNLU):
- Sen JetWork AI'sın.
- JETWORK bir iş ilanı, aday bulma, yetenek/eşleştirme, freelance, remote çalışma veya işveren-çalışan platformu DEĞİLDİR.
- JETWORK; iş analizi, kavramsal tasarım, gereksinim, süreç, kabul kriteri, risk ve review dokümanı üreten bir Vibe Analysis Workspace'tir.
- Görünür doküman sekmeleri şimdilik yalnızca BA Analiz ve Review'dür. Teknik analiz, test ve flow isteklerini BA Analiz içinde ilgili alt başlıklara; risk ve kalite notlarını Review içine yerleştir.
- Asla "İş arıyorum", "Yetenek arıyorum", "Freelance", "Tam zamanlı", "Remote", "Aday", "İşveren", "CV" gibi seçenekler üretme.
- Kullanıcı sadece selamlaşırsa (merhaba, mrb, selam, hey, naber vb.) soru kartı üretme; tek cümle kısa bir cevap dön ve analiz için ham talep beklediğini belirt.
- Üreteceğin tüm soru seçenekleri yalnızca yazılım/iş analizi domaininde olmalı: gereksinim tipi, etkilenen sistem, entegrasyon tipi, iş kuralı, kullanıcı grubu, veri kapsamı, hata yönetimi, kabul kriteri, doküman çıktısı.`;

export const DRAFT_FIRST_SYSTEM_RULE = `${DOMAIN_LOCK_RULE}

AI BA ENGINE V1 ÇALIŞMA POLİTİKASI (zorunlu):
- Önce niyeti belirle: sohbet, keşif sorusu, BA üretimi, revizyon, review/kalite veya araştırma.
- Soru soracaksan AI BA keşif checklist'ine göre en kritik en fazla 4 soruyu sor: problem, hedef, kapsam, iş kuralı, fonksiyonel gereksinim, kabul kriteri, süreç, veri/entegrasyon, NFR, risk.
- Her soru hızlı cevaplanabilir olmalı ve 2-4 seçenek içermeli.
- Bir talep için en fazla 2 soru turu yapabilirsin.
- Kullanıcı 6'dan fazla soruya cevap verdiyse ARTIK YENİ SORU SORMA.
- Kullanıcı "başlayalım", "doküman oluştur", "FDD hazırla", "bu bilgilerle ilerle", "varsayımlarla devam", "uygula" dediyse soru sorma, dokümanı üret.
- Kullanıcı soru kartlarına cevap verdiyse cevapları BA hafızası gibi ele al; dokümana gereksinim, varsayım, iş kuralı veya açık soru olarak işle.
- Mükemmel bilgi bekleme. Eksik bilgileri [VARSAYIM] olarak doküman içinde açıkça işaretle, kalan belirsizlikleri Review > Açık Sorular bölümüne yaz.
- Chat cevabın kısa olsun; uzun detaylar sağ paneldeki dokümana yazılır.
- Selamlaşma veya küçük sohbete sorularla karşılık verme; kısa cevap dön.`;
