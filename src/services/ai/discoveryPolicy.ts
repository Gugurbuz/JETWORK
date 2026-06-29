import { DocumentData, Message } from '../../types';

export interface DiscoverySignals {
  forceGenerate: boolean;
  stopQuestions: boolean;
  greetingOnly: boolean;
  newStandaloneRequest: boolean;
  answeredQuestionCount: number;
  questionRoundCount: number;
  documentReadinessScore: number;
  mustGenerateNow: boolean;
  reason: string;
}

const FORCE_GENERATE_PATTERNS: RegExp[] = [
  /\b(tamam|ok|next)\b/i,
  /\bsonraki\s+ad[ıi]m(?:a)?\b/i,
  /\b(devam\s+et|durma|calismaya\s+devam|çalışmaya\s+devam)\b/i,
  /\b(ben\s+mi\s+yap[ıi]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\bevet[,\s!.?]*\s*(başlayalım|başla|başlayabilirsin|devam|ilerleyelim|ilerle|olsun|tabii)/i,
  /\b(h[ıi]zl[ıi]\s+taslak|ilk\s+tasla[ğg]?[ıi]?\s*(c[ıi]kar|olu[şs]tur|haz[ıi]rla|uret|üret|yaz)|kabaca\s+taslak|taslakla\s+ilerle)\b/i,
  /\bbu\s+bilgilerle\s+(ilerle|devam|oluştur|olustur|yaz|hazırla|hazirla)/i,
  /\bvarsay[ıi]mlarla\s+(devam|ilerle|oluştur|olustur|hazırla|hazirla)/i,
  /\bmevcut\s+bilgilerle\b/i,
  /\buygula\b/i,
];

const STOP_QUESTION_PATTERNS: RegExp[] = [
  /\b(soru\s+sorma|soru\s+istemiyorum|sorular[ıi]\s+b[ıi]rak|sorulari\s+birak)\b/i,
  /\b(ben\s+mi\s+yap[ıi]cam|ben\s+mi\s+yapacagim|sen\s+yap)\b/i,
  /\b(varsay[ıi]mlarla|mevcut\s+bilgilerle|bu\s+bilgilerle)\b/i,
  /\byeter\s*(artık|artik)?\b/i,
  /\bdaha\s*(fazla)?\s*soru\s*sorma\b/i,
];

const GREETING_PATTERNS: RegExp[] = [
  /^\s*(selam(lar)?|slm|mrb|mrhb|merhaba|merhabalar|hey|hi|hello|naber|nbr|nas[ıi]ls[ıi]n|ne haber|günaydın|gunaydin|iyi akşamlar|iyi aksamlar|iyi geceler|kolay gelsin)\s*[!?.,]*\s*$/i,
];

const GREETING_TOKENS = ['mrb', 'mrhb', 'merhaba', 'merhabalar', 'selam', 'selamlar', 'slm', 'hey', 'hi', 'hello', 'naber', 'nbr', 'nasılsın', 'nasilsin'];

const SMALL_TALK_CORRECTION_PATTERNS: RegExp[] = [
  /\b(selam|naber|mrb|slm|merhaba|hey)\b.*\b(dedim|yazdım|yazdim|söyledim|soyledim|verdim)\b/i,
  /\bsadece\s+(selam|naber|mrb|slm|merhaba|hey)\b/i,
  /\bne\s+sorusu\s*ya?\b/i,
  /\bneden\s+soru\s+soruyorsun\b/i,
];

const BLOCKED_QUESTION_TERMS = [
  'iş arıyorum', 'is ariyorum', 'eleman arıyorum', 'yetenek arıyorum', 'aday arıyorum',
  'freelance', 'tam zamanlı', 'yarı zamanlı', 'remote', 'hibrit', 'işveren', 'isveren',
  'job', 'talent', 'recruit', 'cv yükle',
];

function normalizeTr(input: string): string {
  return (input || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeDiscoveryText(input: string): string {
  return normalizeTr(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function isGreetingLike(message: string): boolean {
  const normalized = normalizeTr(message);
  if (!normalized) return false;
  if (GREETING_PATTERNS.some((re) => re.test(message))) return true;
  if (SMALL_TALK_CORRECTION_PATTERNS.some((re) => re.test(message))) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length <= 6 && tokens.some((token) => GREETING_TOKENS.includes(token));
}

const getSender = (message: Message): string => String((message as any).sender || message.role || '').toLowerCase();

function countQuestionRounds(messages: Message[]): number {
  return messages
    .filter((message) => ['ai', 'model'].includes(getSender(message)))
    .filter((message) => Array.isArray((message as any).questions) && (message as any).questions.length > 0)
    .length;
}

function countAnsweredQuestions(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    if (getSender(message) === 'user' && typeof message.text === 'string') {
      const markerMatches = message.text.match(/\*\*Soru\s+\d+:\*\*/g);
      const answerMatches = message.text.match(/\bCevap\s*:/gi);
      total += Math.max(markerMatches?.length || 0, answerMatches?.length || 0);
    }
  }
  return total;
}

function hasPendingQuestionRound(messages: Message[]): boolean {
  let lastQuestionIndex = -1;
  let lastStructuredAnswerIndex = -1;
  messages.forEach((message, index) => {
    const sender = getSender(message);
    if (['ai', 'model'].includes(sender) && Array.isArray((message as any).questions) && (message as any).questions.length > 0) {
      lastQuestionIndex = index;
    }
    if (sender === 'user' && /\*\*Soru\s+\d+:\*\*|\bCevap\s*:/i.test(String(message.text || ''))) {
      lastStructuredAnswerIndex = index;
    }
  });
  return lastQuestionIndex >= 0 && lastQuestionIndex > lastStructuredAnswerIndex;
}

function isLikelyStandaloneProjectRequest(userMessage: string): boolean {
  const text = normalizeDiscoveryText(userMessage);
  if (!text || /\*\*soru\s+\d+:\*\*|\bcevap\s*:/.test(text)) return false;
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const hasProjectSignal = /(proje|uygulama|entegrasyon|refactoring|refaktoring|donusum|d2d|mobil|mobile|sap|crm|iys|saha satis|satis uygulamasi|kavramsal|dokuman|analiz|tasarim)/.test(text);
  const hasActionSignal = /(yazalim|hazirla|olustur|uret|yaz|donusum|refactoring|refaktoring|entegrasyon|projesi|uygulamamiz)/.test(text);
  return tokenCount >= 4 && hasProjectSignal && hasActionSignal;
}

function isSparseInitialDomainDocumentRequest(userMessage: string, messages: Message[], document: DocumentData | null): boolean {
  if (document || messages.length > 0) return false;
  const text = normalizeDiscoveryText(userMessage);
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const looksLikeSapDomain = /sap\s*crm/.test(text) && /(ai|yapay zeka|bot|chatbot|asistan|satis|sales|iys|ileti yonetim sistemi)/.test(text);
  const asksForDocumentOutput = /(ba analiz|kavramsal|tasarim|dokuman|rapor|brd|fdd|hazirla|olustur|uret|yaz)/.test(text);
  const explicitlyAllowsDraft = /(varsayimlarla|soru sorma|bu bilgilerle|mevcut bilgilerle|hizli taslak|ilk taslagi|sen yap)/.test(text);
  return looksLikeSapDomain && asksForDocumentOutput && !explicitlyAllowsDraft && tokenCount <= 14;
}

function scoreDocumentReadiness(document: DocumentData | null, history: Message[]): number {
  let score = 0;
  if (document) {
    const ba = String((document as any).businessAnalysis?.content || '');
    const review = String((document as any).review?.content || '');
    if (ba.length > 200) score += 20;
    if (ba.length > 900) score += 20;
    if (ba.length > 2500) score += 20;
    if (review.length > 100) score += 10;
  }
  const combined = history.filter((m) => getSender(m) === 'user').map((m) => (m.text || '').toLowerCase()).join('\n');
  [/middleware|cpi|api|servis/, /batch|delta|senkron|asenkron/, /retry|kuyruk|hata/, /log|audit|izleme/, /rol|yetki/, /kpi|ölçüm|olcum/].forEach((re) => {
    if (re.test(combined)) score += 5;
  });
  return Math.min(100, score);
}

export function containsBlockedQuestionDomain(questions: Array<{ text?: string; options?: string[] }> | undefined | null): boolean {
  if (!questions || questions.length === 0) return false;
  const text = JSON.stringify(questions).toLocaleLowerCase('tr-TR');
  return BLOCKED_QUESTION_TERMS.some((term) => text.includes(term));
}

export function detectSignals(userMessage: string): { forceGenerate: boolean; stopQuestions: boolean; greetingOnly: boolean } {
  const msg = (userMessage || '').trim();
  return {
    forceGenerate: FORCE_GENERATE_PATTERNS.some((re) => re.test(msg)),
    stopQuestions: STOP_QUESTION_PATTERNS.some((re) => re.test(msg)),
    greetingOnly: isGreetingLike(msg),
  };
}

export function computeDiscoverySignals(userMessage: string, messages: Message[], document: DocumentData | null): DiscoverySignals {
  const { forceGenerate, stopQuestions, greetingOnly } = detectSignals(userMessage);
  const questionRoundCount = countQuestionRounds(messages);
  const answeredQuestionCount = countAnsweredQuestions(messages);
  const documentReadinessScore = scoreDocumentReadiness(document, messages);
  const shouldProtectInitialDiscovery = isSparseInitialDomainDocumentRequest(userMessage, messages, document);
  const newStandaloneRequest = hasPendingQuestionRound(messages) && isLikelyStandaloneProjectRequest(userMessage);

  let reason = '';
  let mustGenerateNow = false;

  if (newStandaloneRequest) {
    reason = 'new_standalone_request_after_questions';
  } else if (forceGenerate && !shouldProtectInitialDiscovery) {
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
  } else if (documentReadinessScore >= 60 && !shouldProtectInitialDiscovery) {
    mustGenerateNow = true;
    reason = 'document_readiness_threshold';
  }

  return {
    forceGenerate,
    stopQuestions,
    greetingOnly,
    newStandaloneRequest,
    answeredQuestionCount,
    questionRoundCount,
    documentReadinessScore,
    mustGenerateNow,
    reason,
  };
}

export const DOMAIN_LOCK_RULE = `ÜRÜN TANIMI (ZORUNLU):
- Sen JetWork AI'sın.
- JETWORK bir iş ilanı, aday bulma, freelance veya işveren-çalışan platformu değildir.
- JETWORK; iş analizi, kavramsal tasarım, gereksinim, süreç, kabul kriteri, risk ve review dokümanı üreten bir Vibe Analysis Workspace'tir.
- Görünür doküman sekmeleri yalnızca BA Analiz ve Review'dur. Teknik analiz, test ve flow isteklerini BA Analiz içinde alt başlık olarak; risk ve kalite notlarını Review içinde işle.
- Kullanıcı sadece selamlaşırsa soru kartı üretme.`;

export const DRAFT_FIRST_SYSTEM_RULE = `${DOMAIN_LOCK_RULE}

AI BA ENGINE ÇALIŞMA POLİTİKASI (zorunlu):
- Önce niyeti belirle: sohbet, keşif sorusu, BA üretimi, revizyon, review/kalite veya araştırma.
- Kullanıcı yalnızca net bir proje fikri yazdıysa bunu otomatik doküman komutu sayma; önce domain'e özel kritik keşif sorularını sor.
- Soru soracaksan en kritik en fazla 3-4 soruyu sor ve her soruda 2-4 hızlı cevap seçeneği üret.
- Kullanıcı yeni bir proje talebi yazarsa, önceki cevaplanmamış soru setiyle karıştırma.
- Kullanıcı "bu bilgilerle ilerle", "varsayımlarla devam", "soru sorma", "ilk taslağı çıkar", "sen yap" veya "uygula" dediyse soru sorma, dokümanı üret.
- Mükemmel bilgi bekleme. Eksik bilgileri [VARSAYIM] olarak doküman içinde işaretle; kalan belirsizlikleri Review > Açık Sorular bölümüne yaz.
- Chat cevabı kısa olsun; uzun detaylar sağ paneldeki dokümana yazılır.`;
