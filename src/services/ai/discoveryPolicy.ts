import { DocumentData, Message } from '../../types';

export interface DiscoverySignals {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
  answeredQuestionCount: number;
  questionRoundCount: number;
  documentReadinessScore: number;
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
  /\b(dokümanı|dokümanı)\s*(oluştur|üret|hazırla|yaz|başlat)/i,
  /\b(analiz(?:i|e)?)\s*(geç|başla|oluştur|hazırla|üret)/i,
  /\bba\s*(analiz(?:i|e)?)\s*(oluştur|hazırla|yaz|üret)/i,
  /\bbu\s+bilgilerle\s+(ilerle|devam|oluştur|yaz|hazırla)/i,
  /\bvarsayımlarla\s+(devam|ilerle|oluştur)/i,
  /\bmevcut\s+bilgilerle\b/i,
  /\btaslak\s*(oluştur|çıkar|hazırla|yaz)/i,
  /\btamam[,\s!.?]*\s*(oluştur|yaz|hazırla|başla|başlayalım)/i,
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

// Phrases that indicate the user is correcting / clarifying that they were
// only greeting, or pushing back on question spam. These must never trigger
// discovery / document generation.
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

  // Exact greeting regex match
  if (GREETING_PATTERNS.some((re) => re.test(message))) return true;

  // Correction / pushback about greeting
  if (SMALL_TALK_CORRECTION_PATTERNS.some((re) => re.test(message))) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const hasGreetingToken = tokens.some((t) => GREETING_TOKENS.includes(t));
  if (!hasGreetingToken) return false;

  // Short messages that are dominated by a greeting token are small talk.
  if (tokens.length <= 6) return true;

  return false;
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

function countQuestionRounds(messages: Message[]): number {
  // A round = an assistant message that surfaced questions.
  let rounds = 0;
  for (const m of messages) {
    if (m.sender === 'ai' && Array.isArray((m as any).questions) && (m as any).questions.length > 0) {
      rounds += 1;
    }
  }
  return rounds;
}

function countAnsweredQuestions(messages: Message[]): number {
  // User replies containing the "Soru N:" / "Cevap:" pattern from InteractiveQuestions.
  let total = 0;
  for (const m of messages) {
    if (m.sender === 'user' && typeof m.text === 'string') {
      const matches = m.text.match(/\*\*Soru\s+\d+:\*\*/g);
      if (matches) total += matches.length;
    }
  }
  return total;
}

// Document readiness. Very rough heuristic over content length + coverage of
// canonical integration fields. Returns 0-100.
function scoreDocumentReadiness(document: DocumentData | null, history: Message[]): number {
  let score = 0;
  if (document) {
    const ba = String((document as any).businessAnalysis?.content || '');
    const code = String((document as any).code?.content || '');
    const test = String((document as any).test?.content || '');
    const review = String((document as any).review?.content || '');
    if (ba.length > 200) score += 20;
    if (ba.length > 800) score += 10;
    if (code.length > 200) score += 15;
    if (test.length > 200) score += 10;
    if (review.length > 100) score += 5;
  }

  // Check for keyword coverage across the user's answered content.
  const combined = history
    .filter((m) => m.sender === 'user')
    .map((m) => (m.text || '').toLowerCase())
    .join('\n');

  const topics: RegExp[] = [
    /\b(middleware|cpi|mulesoft|apigee|integration\s*suite)\b/,
    /\b(senkron|asenkron|sync|realtime|gerçek\s*zaman|batch)\b/,
    /\b(oauth|basic auth|jwt|api key|güvenlik)\b/,
    /\b(retry|yeniden dene|kuyruk|queue)\b/,
    /\b(log|z\s*tablo|izleme|monitoring)\b/,
    /\b(rest|soap|odata|service)\b/,
    /\b(hata|error|istisna|exception)\b/,
    /\b(rol|yetki|role)\b/,
  ];
  for (const re of topics) {
    if (re.test(combined)) score += 5;
  }

  return Math.min(100, score);
}

export function computeDiscoverySignals(
  userMessage: string,
  messages: Message[],
  document: DocumentData | null
): DiscoverySignals {
  const { forceGenerate, stopQuestions, greetingOnly } = detectSignals(userMessage);
  const questionRoundCount = countQuestionRounds(messages);
  const answeredQuestionCount = countAnsweredQuestions(messages);
  const documentReadinessScore = scoreDocumentReadiness(document, messages);

  let reason = '';
  let mustGenerateNow = false;

  if (forceGenerate) {
    mustGenerateNow = true;
    reason = 'user_force_generate';
  } else if (stopQuestions) {
    mustGenerateNow = true;
    reason = 'user_stop_questions';
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
    mustGenerateNow,
    reason,
  };
}

export const DOMAIN_LOCK_RULE = `ÜRÜN TANIMI (ZORUNLU):
- Sen JetWork AI'sın.
- JETWORK bir iş ilanı, aday bulma, yetenek/eşleştirme, freelance, remote çalışma veya işveren-çalışan platformu DEĞİLDİR.
- JETWORK; iş analizi (BA), teknik analiz (IT), test senaryoları, süreç akışı (FLOW) ve review dokümanı üreten bir Vibe Analysis Workspace'tir.
- Asla "İş arıyorum", "Yetenek arıyorum", "Freelance", "Tam zamanlı", "Remote", "Aday", "İşveren", "CV" gibi seçenekler üretme.
- Kullanıcı sadece selamlaşırsa (merhaba, mrb, selam, hey, naber vb.) soru kartı üretme; tek cümle kısa bir cevap dön ve analiz için ham talep beklediğini belirt.
- Üreteceğin tüm soru seçenekleri yalnızca yazılım/iş analizi domaininde olmalı: gereksinim tipi, etkilenen sistem, entegrasyon tipi, iş kuralı, kullanıcı grubu, veri kapsamı, hata yönetimi, test kapsamı, doküman çıktısı.`;

export const DRAFT_FIRST_SYSTEM_RULE = `${DOMAIN_LOCK_RULE}

SORU SORMA POLİTİKASI (zorunlu):
- Bir talep için en fazla 2 soru turu yapabilirsin.
- Her turda en fazla 4 soru sor.
- Kullanıcı 6'dan fazla soruya cevap verdiyse ARTIK YENİ SORU SORMA.
- Kullanıcı "başlayalım", "doküman oluştur", "FDD hazırla", "bu bilgilerle ilerle", "varsayımlarla devam" dediyse soru sorma, dokümanı üret.
- Mükemmel bilgi bekleme. Eksik bilgileri VARSAYIM olarak doküman içinde açıkça işaretle, kalan belirsizlikleri Review > Açık Sorular bölümüne yaz.
- Chat cevabın kısa olsun; uzun detaylar sağ paneldeki dokümana yazılır.
- Selamlaşma veya küçük sohbete sorularla karşılık verme; kısa cevap dön.`;
